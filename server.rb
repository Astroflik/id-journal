#!/usr/bin/env ruby
# frozen_string_literal: true

require 'webrick'
require 'json'
require 'securerandom'
require 'digest'
require 'openssl'
require 'pstore'
require 'fileutils'
require 'uri'

ROOT = File.expand_path(__dir__)
PUBLIC = File.join(ROOT, 'public')
DATA_DIR = File.expand_path(ENV.fetch('DATA_DIR', File.join(ROOT, '.data')))
PORT = Integer(ENV.fetch('PORT', '8766'))
HOST = ENV.fetch('HOST', '127.0.0.1')
SESSION_COOKIE = 'journal_session'
SESSION_TTL = 30 * 24 * 60 * 60
PASSWORD_ITERATIONS = 310_000
MAX_STATE_BYTES = 5 * 1024 * 1024
MAX_BODY_BYTES = MAX_STATE_BYTES + 16 * 1024

class ApiError < StandardError
  attr_reader :status

  def initialize(message, status = 400)
    super(message)
    @status = status
  end
end

File.umask(0o077)
FileUtils.mkdir_p(DATA_DIR, mode: 0o700)
File.chmod(0o700, DATA_DIR)
STORE = PStore.new(File.join(DATA_DIR, 'accounts.pstore'))
STORE.ultra_safe = true
STORE_MUTEX = Mutex.new
RATE_MUTEX = Mutex.new
LOGIN_ATTEMPTS = {}

def json_response(response, status, value)
  response.status = status
  response['Content-Type'] = 'application/json; charset=utf-8'
  response['Cache-Control'] = 'no-store'
  response.body = JSON.generate(value)
end

def request_json(request)
  length = request['content-length'].to_i
  raise ApiError.new('Request is too large', 413) if length > MAX_BODY_BYTES

  body = request.body.to_s
  raise ApiError.new('Request is too large', 413) if body.bytesize > MAX_BODY_BYTES

  parsed = JSON.parse(body)
  raise ApiError, 'Expected a JSON object' unless parsed.is_a?(Hash)

  parsed
rescue JSON::ParserError
  raise ApiError, 'Invalid JSON'
end

def secure_equal(left, right)
  return false unless left.is_a?(String) && right.is_a?(String) && left.bytesize == right.bytesize

  left.bytes.zip(right.bytes).reduce(0) { |result, pair| result | (pair[0] ^ pair[1]) }.zero?
end

def password_digest(password, salt)
  OpenSSL::PKCS5.pbkdf2_hmac(password, salt, PASSWORD_ITERATIONS, 32, 'sha256').unpack1('H*')
end

def issue_cookie(response, request, token)
  attributes = ["#{SESSION_COOKIE}=#{token}", 'Path=/', "Max-Age=#{SESSION_TTL}", 'HttpOnly', 'SameSite=Lax']
  attributes << 'Secure' if request.ssl? || request['x-forwarded-proto'].to_s.split(',').first.to_s.strip == 'https'
  response['Set-Cookie'] = attributes.join('; ')
end

def clear_cookie(response, request)
  attributes = ["#{SESSION_COOKIE}=", 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT']
  attributes << 'Secure' if request.ssl? || request['x-forwarded-proto'].to_s.split(',').first.to_s.strip == 'https'
  response['Set-Cookie'] = attributes.join('; ')
end

def enforce_same_origin!(request)
  origin = request['origin']
  if origin && !origin.empty?
    origin_host = URI.parse(origin).host
    raise ApiError.new('Cross-origin request rejected', 403) unless origin_host && origin_host.casecmp(request.host).zero?
  end
  raise ApiError.new('Cross-site request rejected', 403) if request['sec-fetch-site'] == 'cross-site'
rescue URI::InvalidURIError
  raise ApiError.new('Invalid request origin', 403)
end

def rate_limited?(request, email)
  key = "#{request.peeraddr[3]}:#{email}"
  now = Time.now.to_i
  RATE_MUTEX.synchronize do
    LOGIN_ATTEMPTS.delete_if { |_attempt_key, attempts| attempts[:at] < now - 900 }
    entry = (LOGIN_ATTEMPTS[key] ||= { count: 0, at: now })
    entry[:count] += 1
    entry[:at] = now
    entry[:count] > 10
  end
end

def user_for_request(request)
  cookie = request.cookies.find { |item| item.name == SESSION_COOKIE }
  token = cookie && cookie.value
  return nil unless token && token.match?(/\A[0-9a-f]{64}\z/)

  token_hash = Digest::SHA256.hexdigest(token)
  now = Time.now.to_i
  user = nil
  STORE_MUTEX.synchronize do
    STORE.transaction do
      sessions = STORE[:sessions] ||= {}
      users = STORE[:users] ||= {}
      session = sessions[token_hash]
      if session && session[:expires_at] > now && users[session[:user_id]]
        session[:expires_at] = now + SESSION_TTL
        user = users[session[:user_id]].dup
      elsif session
        sessions.delete(token_hash)
      end
    end
  end
  user
end

def create_session(response, request, user_id)
  token = SecureRandom.hex(32)
  token_hash = Digest::SHA256.hexdigest(token)
  STORE_MUTEX.synchronize do
    STORE.transaction do
      sessions = STORE[:sessions] ||= {}
      sessions.delete_if { |_key, item| item[:expires_at] <= Time.now.to_i }
      sessions[token_hash] = { user_id: user_id, expires_at: Time.now.to_i + SESSION_TTL }
    end
  end
  issue_cookie(response, request, token)
end

def account_payload(user)
  state = nil
  STORE_MUTEX.synchronize do
    STORE.transaction(true) do
      state = (STORE[:states] || {})[user[:id]]
    end
  end
  { authenticated: true, email: user[:email], state: state }
end

def handle_register(request, response)
  enforce_same_origin!(request)
  input = request_json(request)
  email = input['email'].to_s.strip.downcase
  password = input['password'].to_s
  raise ApiError, 'Enter a valid email address' unless email.bytesize <= 254 && email.match?(/\A[^@\s]+@[^@\s]+\.[^@\s]+\z/)
  raise ApiError, 'Password must be at least 12 characters' if password.length < 12
  raise ApiError, 'Password is too long' if password.bytesize > 1024
  raise ApiError.new('Too many attempts. Try again in 15 minutes.', 429) if rate_limited?(request, email)

  salt = SecureRandom.hex(16)
  digest = password_digest(password, salt)
  user = { id: SecureRandom.uuid, email: email, salt: salt, password_digest: digest, created_at: Time.now.to_i }
  created = false
  STORE_MUTEX.synchronize do
    STORE.transaction do
      users = STORE[:users] ||= {}
      emails = STORE[:emails] ||= {}
      unless emails.key?(email)
        users[user[:id]] = user
        emails[email] = user[:id]
        created = true
      end
    end
  end
  raise ApiError.new('An account with this email already exists. Sign in instead.', 409) unless created

  create_session(response, request, user[:id])
  json_response(response, 201, account_payload(user))
end

def handle_login(request, response)
  enforce_same_origin!(request)
  input = request_json(request)
  email = input['email'].to_s.strip.downcase
  password = input['password'].to_s
  raise ApiError.new('Too many attempts. Try again in 15 minutes.', 429) if rate_limited?(request, email)

  user = nil
  STORE_MUTEX.synchronize do
    STORE.transaction(true) do
      id = (STORE[:emails] || {})[email]
      user = (STORE[:users] || {})[id] if id
    end
  end
  supplied = password_digest(password, user ? user[:salt] : 'not-a-real-account-salt')
  valid = user && secure_equal(supplied, user[:password_digest])
  raise ApiError.new('Email or password is incorrect', 401) unless valid

  create_session(response, request, user[:id])
  json_response(response, 200, account_payload(user))
end

def handle_state(request, response)
  enforce_same_origin!(request)
  user = user_for_request(request)
  return json_response(response, 401, { error: 'Sign in required' }) unless user

  input = request_json(request)
  state = input['state']
  unless state.is_a?(Hash) && JSON.generate(state).bytesize <= MAX_STATE_BYTES
    return json_response(response, 413, { error: 'Account data is too large' })
  end

  STORE_MUTEX.synchronize do
    STORE.transaction do
      states = STORE[:states] ||= {}
      states[user[:id]] = state
    end
  end
  json_response(response, 200, { saved: true })
end

def static_file_for(path)
  relative = path == '/' ? 'index.html' : path.sub(%r{\A/}, '')
  return nil unless relative.match?(/\A(?:index\.html|app\/index\.html|firebase-config\.js|assets\/[A-Za-z0-9._-]+)\z/)

  full_path = File.expand_path(relative, PUBLIC)
  return nil unless full_path.start_with?(PUBLIC + File::SEPARATOR) && File.file?(full_path)

  full_path
end

server = WEBrick::HTTPServer.new(
  BindAddress: HOST,
  Port: PORT,
  AccessLog: [],
  Logger: WEBrick::Log.new($stdout, WEBrick::Log::INFO),
  MaxClients: 32,
  RequestTimeout: 30
)

server.mount_proc('/') do |request, response|
  response['X-Content-Type-Options'] = 'nosniff'
  response['Referrer-Policy'] = 'same-origin'
  response['X-Frame-Options'] = 'DENY'

  if request.path.start_with?('/api/')
    case [request.request_method, request.path]
    when ['GET', '/api/session']
      user = user_for_request(request)
      if user
        issue_cookie(response, request, request.cookies.find { |item| item.name == SESSION_COOKIE }.value)
        json_response(response, 200, account_payload(user))
      else
        json_response(response, 200, { authenticated: false })
      end
    when ['POST', '/api/register']
      handle_register(request, response)
    when ['POST', '/api/login']
      handle_login(request, response)
    when ['PUT', '/api/state']
      handle_state(request, response)
    when ['POST', '/api/logout']
      enforce_same_origin!(request)
      token = request.cookies.find { |item| item.name == SESSION_COOKIE }&.value
      if token && token.match?(/\A[0-9a-f]{64}\z/)
        token_hash = Digest::SHA256.hexdigest(token)
        STORE_MUTEX.synchronize do
          STORE.transaction { (STORE[:sessions] ||= {}).delete(token_hash) }
        end
      end
      clear_cookie(response, request)
      json_response(response, 200, { authenticated: false })
    else
      json_response(response, 404, { error: 'Not found' })
    end
  else
    file = static_file_for(request.path)
    if file
      response.status = 200
      response['Content-Type'] = if file.end_with?('.png')
        'image/png'
      elsif file.end_with?('.js')
        'application/javascript; charset=utf-8'
      else
        'text/html; charset=utf-8'
      end
      response['Cache-Control'] = file.end_with?('.png') ? 'public, max-age=86400' : 'no-cache'
      response.body = File.binread(file)
    else
      response.status = 404
      response.body = 'Not found'
    end
  end
rescue ApiError => error
  json_response(response, error.status, { error: error.message })
rescue ArgumentError => error
  json_response(response, 400, { error: error.message })
rescue StandardError => error
  warn "Request failed: #{error.class}: #{error.message}"
  json_response(response, 500, { error: 'Internal server error' })
end

%w[INT TERM].each { |signal| trap(signal) { server.shutdown } }
puts "Journal is running at http://#{HOST}:#{PORT}"
puts "Account data is stored privately at #{File.join(DATA_DIR, 'accounts.pstore')}"
server.start
