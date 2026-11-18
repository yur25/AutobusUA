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

Потрібні Node.js 24+ і npm.

```bash
npm install
npm run start:dev
```

Перевірка доступності застосунку:

```text
GET http://localhost:3000/health
```

Production-збірка та запуск:

```bash
npm run build
npm start
```

Повний локальний pipeline перевірок:

```bash
npm run verify
```

Деталі архітектури описані у [Spec 01](docs/specs/01-foundation.md), а
архітектурні рішення — у [ADR](docs/adr/README.md).
