# Правила проекта

- Отвечать по-русски, коротко, простыми шагами. Пользователь не пишет код.
- Скриншоты можно, но в меру: только когда без взгляда на экран не проверить, без злоупотребления.
- Репозиторий публичный: никаких ключей, паролей, токенов и личных данных (имена, email) в коде, коммитах и файлах.
- Перед push: `git fetch origin main && git rebase origin/main`.
- После правок `python3 tests/sync_smoke.py` должно быть ALL PASS. Если нет — не мержить и не пушить.

## Контекст
Сайт журнала для трейдеров по Order Flow: статический фронт в `public/`, бэкенд Supabase, хостинг GitHub Pages и Cloudflare Pages. Подробные заметки лежат локально в `docs/handoff/` (не коммитятся). Начинай с journal-next-chat.md, остальное читай по необходимости.

## Работа (автопилот)
- Работай самостоятельно, сообщай по итогам или если случилось что-то важное. Вопросы мне только если без ответа продолжить нельзя, остальное решай сам и укажи в итоге, что решил.
- Экономь токены: читай нужные куски файлов, большие (scene.js) целиком не читай.
- Скажи, если этапу нужна модель сильнее или можно взять слабее.

## Скиллы и инструменты (подключены глобально, работают сами)
- Любая задача про сайт, страницу, лендинг, экран, интерфейс, стили, дизайн или вёрстку (слова «сайт», «страница», «лендинг», «дизайн» и подобные): сразу подключай вместе impeccable и frontend-design. Сам реши, какой ведёт, а какой дополняет. Анимации и переходы: animate.
- Superpowers: для нетривиальных задач (новая функция, сложная правка, баг) работай по его процессу: план, отладка по порядку, проверка перед словом «готово». Мелкие правки делай без церемоний. Вопросы мне задавай только по правилу автопилота выше.
- Память claude-mem работает сама: опирайся на неё, чтобы знать, где мы и что уже решено, и не переспрашивай известное.
- Task Observer: в начале сессии вызови скилл task-observer и выполни его Session Start Protocol, после задачи одной строкой сообщи о записанных наблюдениях.
- Всё про Supabase (RLS, миграции, auth, политики): скиллы Supabase и MCP supabase. Документация библиотек: Context7 вместо догадок по памяти.
- Нет нужного скилла: найди через find-skills и ставь сам, без вопросов, но только из известных источников (Anthropic, Vercel, Supabase, популярные репозитории). Каждую установку запиши в `docs/handoff/installed-skills.md`: что, откуда, когда.
- Headroom сжимает вывод инструментов сам, ничего делать для него не нужно.
- Не вызывай скиллы, которые не относятся к задаче.

## Git и публикация
- Push в main сразу публикует сайт. Работай в ветке, в main только по моему «да».
- Коммиты только с noreply-почтой GitHub.

## Миграции Supabase
Файл + тесты, холостой прогон (begin; …; rollback;), простое описание мне и моё «да», только потом apply_migration.

## Необратимое
Удаление баз, проектов и файлов только с моим явным «да».

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
