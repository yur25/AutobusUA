# AutobusUA

Backend-платформа для пошуку міжміських автобусних рейсів по Україні та
купівлі квитків.

## Стек

- Node.js, TypeScript, NestJS;
- PostgreSQL та Prisma заплановані для наступного етапу;
- ESLint, Prettier, TypeScript strict mode;
- Husky і lint-staged.

## Стан проєкту

Зараз підготовлено інженерну основу: ESM NestJS-каркас, модулі-заглушки,
quality tooling, git hooks, smoke test і документацію. Бізнес-логіка та робота
з базою даних ще не реалізовані.

## Встановлення та запуск

Потрібні Node.js 24+, npm і GNU Make.

```bash
make install
make dev
```

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

Деталі архітектури описані у [Spec 01](docs/specs/01-foundation.md), а
архітектурні рішення — у [ADR](docs/adr/README.md).
