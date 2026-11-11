# Данные вкладки «Брифинг»

Файлы обновляет запланированная задача Claude. **Репозиторий публичный: личных данных, счетов, сделок и чужих платных материалов здесь быть не должно.**

## latest.json
```json
{
  "date": "2026-11-11",              // дата по Киеву, YYYY-MM-DD
  "updatedAt": "2026-11-11T13:50:00Z",
  "instrument": "NQ",
  "bias": { "dir": "long|short|neutral", "confidence": "low|medium|high", "summary": "..." },
  "recap": { "text": "разбор вчерашнего дня (если вчера не торговали)" },
  "why": [ { "title": "звено 1", "text": "причина" } ],
  "confirm": ["что подтвердит сценарий"],
  "invalidate": ["что его сломает"],
  "calendar": [ { "time": "15:30", "event": "CPI", "forecast": "3.1%", "actual": "", "reaction": "" } ],
  "options": { "summary": "", "levels": [ { "name": "Gamma flip", "price": "21000", "note": "" } ], "explain": "", "quality": "откуда данные и насколько им можно верить" },
  "earnings": [ { "company": "NVDA", "when": "после закрытия", "note": "" } ],
  "risks": ["..."],
  "weekly": { "text": "обзор недели (по воскресеньям)" },
  "lesson": { "title": "Урок дня", "text": "..." }
}
```
Если сводки нет: `{"date": null}`.

## history.json (табло точности)
```json
[ { "date": "2026-11-10", "bias": "long", "confidence": "medium", "result": "hit|miss|partial|pending", "note": "почему" } ]
```
