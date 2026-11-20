# AutobusUA

Backend-платформа для пошуку міжміських автобусних рейсів по Україні та
купівлі квитків.

## Стек

- Node.js, TypeScript, NestJS;
- in-memory storage для поточного прототипу; PostgreSQL через `pg` та
  параметризований SQL заплановані для наступного етапу;
- ESLint, Prettier, TypeScript strict mode;
- Husky і lint-staged.

## Стан проєкту

HTTP API реалізовано на in-memory storage: автентифікація, заявки
перевізників, рейси й квитки. Дані зберігаються лише в пам'яті процесу та
втрачаються після перезапуску; PostgreSQL ще не підключена.

## Встановлення та запуск

Потрібні Node.js 24+, npm і GNU Make.

```bash
make install
make dev
```

Щоб переглядати та схвалювати заявки перевізників, задайте bootstrap admin
змінні середовища до запуску. Обидві змінні обов'язкові разом; пароль має
містити щонайменше 12 символів. Без них застосунок запускається без
адміністраторського облікового запису.

```bash
BOOTSTRAP_ADMIN_PHONE=+380501234567 \
BOOTSTRAP_ADMIN_PASSWORD='replace-with-a-secret-of-12-or-more-characters' \
make dev
```

API починається з `/api/v1`; ключові маршрути наведені в
[Spec 02](docs/specs/02-implementation.md) та [ER/API diagram](docs/er-diagram.md).

Перевірка доступності застосунку:

```text
GET http://localhost:3000/health
```

Версія збірки та Git commit SHA:

```text
GET http://localhost:3000/version
```

Для `make build` SHA коміту зчитується під час build і вбудовується в артефакт.
У середовищі збірки поза Git-репозиторієм можна передати повний SHA через
`GIT_COMMIT`.

Production-збірка та запуск:

```bash
make build
make start
```

Повний локальний pipeline перевірок:

```bash
make verify
```

`make help` показує доступні команди, зокрема `test`, `smoke`, `typecheck`,
`lint`, `format` і `format-check`.

Автоматизовані тести на цьому етапі обмежені smoke-перевірками запуску та
базових endpoints. Повні unit, integration, end-to-end та mutation tests
відкладені до наступної лабораторної.

Деталі вимог описані у [Spec 01](docs/specs/01-foundation.md) і
[Spec 02](docs/specs/02-implementation.md), а
архітектурні рішення — у [ADR](docs/adr/README.md).
