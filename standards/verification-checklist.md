# Verification checklist

Чеклист відповідає поточному етапу AutobusUA: ESM NestJS-каркас, quality
tooling, smoke test і git hooks. Пункти про бізнес-логіку, БД, міграції,
авторизацію та продуктивність застосовуються після їх появи.

## 1. Під час розробки

- [ ] Після змін запустити `npm run format`.
- [ ] Перевірити стиль без змін через `npm run format:check`.
- [ ] Запустити `npm run lint`.
- [ ] Запустити `npm run typecheck`; він перевіряє `src/` і `tests/`.
- [ ] Для змін runtime перевірити `npm run smoke:test`.
- [ ] Для повної локальної перевірки запустити `npm run verify`.

## 2. Перед commit

- [ ] Переглянути зміни через `git diff` і `git status --short`.
- [ ] Перевірити пробіли та конфліктні маркери через `git diff --check`.
- [ ] Додати лише потрібні файли через `git add <files>`.
- [ ] Виконати звичайний `git commit`; Husky автоматично запускає
  `pre-commit`, який виконує `npx lint-staged`.
- [ ] Переконатися, що для staged `.ts`/`.mjs` файлів `lint-staged` виконує
  Prettier і ESLint.
- [ ] При помилці форматування або lint commit має бути заблокований.

Приклад commit:

```bash
git add package.json src tests
git commit -m "chore: configure project quality tools"
```

## 3. Перед push

- [ ] Переконатися, що commit створено після успішного pre-commit.
- [ ] Виконати звичайний `git push`; Husky автоматично запускає `pre-push`,
  який виконує `npm run verify`.
- [ ] Переконатися, що `npm run verify` послідовно виконує:
  `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`
  і `npm run smoke:test`.
- [ ] Push має бути заблокований при помилці будь-якого кроку `verify`.

## 4. Фінальна перевірка перед аудитом

- [ ] Запустити `npm ci` для перевірки відтворення залежностей за lockfile.
- [ ] Запустити `npm run verify`.
- [ ] Перевірити production-запуск: `npm run build` і `npm start`.
- [ ] Перевірити endpoint `GET http://localhost:3000/health`.
- [ ] Перевірити встановлені top-level залежності через `npm ls --depth=0`.
- [ ] Перевірити відсутність незадокументованих змін через `git diff --check` і
  `git status --short`.
- [ ] Після цього провести аудит відповідності структури spec і визначити
  топ-3 зайві або неправильні залежності.

## 5. Не застосовується на поточному етапі

- `N/A` — unit, integration та end-to-end тести бізнес-сценаріїв: бізнес-логіка
  ще не реалізована.
- `N/A` — Prisma schema, міграції, seed і перевірки PostgreSQL: БД ще не
  підключена.
- `N/A` — перевірка ролей, власності даних і конкурентної купівлі: API та
  відповідні модулі ще є заглушками.
- `N/A` — навантажувальні тести, індекси, N+1 і вимірювані performance-пороги:
  відсутній runtime-доступ до даних.
