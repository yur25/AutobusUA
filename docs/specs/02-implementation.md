# Spec 02

## Реалізація робочого API AutobusUA

## Context

### Current state

Є ESM NestJS API з модулями `Auth`, `Carriers`, `Trips`, `Bookings`.
Поточне сховище — PostgreSQL через `pg`; попередня in-memory реалізація
замінена без зміни зовнішнього HTTP API.

### Problem

Потрібно реалізувати бізнес-сценарії через HTTP спочатку на in-memory, потім
на PostgreSQL без зміни зовнішнього API і service contracts.

## Goal

Реалізувати HTTP API реєстрації, автентифікації, заявок перевізника, рейсів і
квитків із сесіями, рольовим доступом, validation, business-process ID,
ідемпотентністю, транзакціями та контролем N+1. Storage змінюється з in-memory
на PostgreSQL без зміни API.

## Scope

### In scope

- REST API під `/api/v1`, health/readiness.
- Makefile як інтерфейс до команд запуску й перевірки.
- Публічний `GET /version` із SHA коміту, для якого зібрано застосунок.
- NestJS controllers, services і repositories з чіткими межами.
- Спільні repository contracts для in-memory/PostgreSQL.
- PostgreSQL через `pg`, параметризовані SQL та міграції.
- Перевірка підключення під час запуску через `SELECT now()`.
- Docker Compose з non-default host port і окремою тестовою БД.
- Native `AsyncLocalStorage`, DI logger і `X-Business-Process-Id`.
- NestJS exceptions, global error formatting і класифікація помилок БД.
- JOIN-запити для списків без N+1.
- Транзакції для купівлі, скасування та змін.
- `Idempotency-Key` і таблиця.
- Мінімальні smoke-тести запуску й базових endpoints та фінальний аудит.

### Out of scope

- Frontend, payment gateway, email/SMS та зовнішній identity provider.
- Сегментація рейсу, вибір місця та проміжні зупинки.
- Редагування або видалення створених рейсів.
- Чернетки рейсів, ручне скасування рейсу та повернення коштів.
- Повноцінні unit, integration, end-to-end та mutation tests; їх розробка
  належить до наступної лабораторної.
- Prisma, SQLite та production deployment поза локальним Docker Compose.

## Implementation

### Application boundaries

Controllers приймають DTO і делегують services. Services містять валідацію,
бізнес-правила та authorization. Repositories приховують storage і не містять
HTTP-логіки.

### API and access

API використовує cookie-сесію `autobusua_session`. Публічні: health,
readiness, version, реєстрація, вхід і пошук. `/version` повертає build commit
SHA без читання Git під час runtime. Авторизований користувач подає заявку;
`ADMIN` її розглядає. `CARRIER` створює незмінні рейси. `PASSENGER` і
`CARRIER` керують власними квитками.

Маршрути: `/auth/*`, `/carrier-applications`, `/trips`,
`/trips/:tripId/tickets`, `/tickets/me`, `/tickets/:id/cancel`. До pagination
застосовуються authorization і бізнес-фільтри. Деталі наведено в
[ER diagram](../er-diagram.md).

### Context and errors

Middleware створює ALS-контекст із UUID `businessProcessId` для кожного
запиту. DI logger додає його до логів і `X-Business-Process-Id`.

Помилки обробляються NestJS exception layer; global filter додає код,
повідомлення і `businessProcessId`. БД недоступна — `503`; constraint,
authorization, not found і неочікувані помилки мають окремі коди. SQL не
розкривається.

### Project commands

Makefile надає цілі встановлення, запуску, тестів, build, typecheck, lint,
format і повної перевірки через npm scripts.

### Storage and transactions

DatabaseModule створює singleton pool, перевіряє `SELECT now()` до HTTP
прийому, надає pool repositories через DI і закриває під час shutdown. Compose
використовує non-default host port; integration tests — окрему БД.

Купівля транзакційно блокує рейс через `SELECT ... FOR UPDATE`, перевіряє
місткість, створює квиток і оновлює `occupied_seats`. Скасування перевіряє
власника, статус і час та змінює квиток із лічильником.

### Idempotency and queries

State-changing операції використовують `Idempotency-Key`, крім реєстрації,
де дублікати захищає unique constraint телефону. Той самий payload повертає
попередній результат, інший — `409`; запис і купівля атомарні.

Списки отримують пов’язані поля JOIN-запитами; N+1 перевіряється аудитом.

### Retry policy

Повторюються лише transient database failures: startup connection failures,
serialization failure (`40001`) і deadlock (`40P01`). Ліміт, backoff,
і безпечні умови повтору визначені в [ER diagram](../er-diagram.md).
Детерміновані помилки та транзакції з невідомим результатом `COMMIT` не
повторюються автоматично без `Idempotency-Key`.

## Acceptance Criteria

- **AC-1:** Користувач може зареєструватися, увійти, вийти та отримати профіль
  через HTTP із серверною сесією.
- **AC-2:** Користувач може подати одну `PENDING` заявку, а `ADMIN` може
  атомарно підтвердити або відхилити її.
- **AC-3:** Підтверджений `CARRIER` може створити рейс, а API не має операцій
  редагування або видалення створеного рейсу.
- **AC-4:** Пошук застосовує authorization і бізнес-фільтри до сортування та
  pagination, а список перевізника містить лише його рейси.
- **AC-5:** `PASSENGER` і `CARRIER` можуть купити, переглянути та скасувати
  власні квитки, а чужі квитки захищені authorization.
- **AC-6:** Дві конкурентні покупки останнього місця дають не більше одного
  успішного квитка та зберігають інваріанти місткості.
- **AC-7:** Послідовні та одночасні повтори покупки з тим самим
  `Idempotency-Key` і payload не створюють дубль, а зміна payload повертає
  `409`.
- **AC-8:** Кожен HTTP-запит має один `businessProcessId` у логах усіх рівнів
  і response header.
- **AC-9:** Недоступна PostgreSQL блокує startup, а runtime-збій доступності
  повертає `503`, не маскуючи інші помилки.
- **AC-10:** Після заміни in-memory storage на PostgreSQL зовнішній HTTP API та
  service contracts не змінюються, а списки не мають N+1-запитів.
- **AC-11:** PostgreSQL pool створюється і перевіряється через `SELECT now()`
  під час startup, використовується repositories та закривається під час
  shutdown.
- **AC-12:** Retry policy повторює лише дозволені transient failures із
  визначеним лімітом, backoff і умовами безпеки, а детерміновані помилки не
  повторюються автоматично.
- **AC-13:** Фінальний аудит містить топ-3 зрізані кути або крайові випадки,
  результати N+1-перевірки та перевірку поведінки при збоях БД.
- **AC-14:** Makefile надає команди для запуску, тестів, build, typecheck,
  lint, format і повної перевірки.
- **AC-15:** Публічний `GET /version` повертає commit SHA, відповідний
  артефакту збірки.

## Verification

- Перевірити рольові HTTP-сценарії, cookie, validation, exceptions і process ID.
- Виконати лише smoke-тести запуску застосунку й базових endpoints.
- Перевірити БД startup/runtime failures, retry policy та shutdown pool у межах
  доступних smoke/manual перевірок; повноцінні автоматизовані сценарії
  відкладаються до наступної лабораторної.
- Перевірити Makefile targets і SHA в `/version`.
- Виконати format, lint, typecheck, build, smoke та verification checklist.
- Завершити роботу аудитом за AC-13 та перевіркою Definition of Done.

## Open Questions

Немає блокуючих питань. Маршрути, DTO, ідемпотентність та обмеження моделі
описані в [ER diagram](../er-diagram.md).
