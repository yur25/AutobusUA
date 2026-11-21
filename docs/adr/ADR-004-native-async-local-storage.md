# ADR-004: Native `AsyncLocalStorage` для контексту запиту

- Status: Accepted
- Date: 2026-11-20
- Deciders: Проєкт AutobusUA
- Technical area: Context propagation і логування
- Related requirements: `docs/specs/02-implementation.md`, `docs/er-diagram.md`
- Supersedes: N/A
- Superseded by: N/A

## Context and Problem Statement

Кожен HTTP-запит потребує унікального `businessProcessId`, який має бути в усіх
пов’язаних логах: controllers, services, repositories, SQL-операціях і
exception filter. ID не можна передавати вручну через кожну сигнатуру.
Потрібно вибрати механізм context propagation, сумісний із NestJS і Node.js.

## Decision Drivers

- Один унікальний ID для кожного HTTP-запиту.
- Доступ до контексту без ручного передавання через усі рівні.
- Мінімум нових залежностей.
- Підтримка DI-managed logger та NestJS middleware.
- Можливість логувати database operations і помилки.

## Considered Options

### Option 1: Native `AsyncLocalStorage`

- Переваги: вбудована Node.js API; окремий store для кожної async chain;
  middleware може створити контекст на початку запиту; доступний усюди в call
  stack; не додає залежності.
- Недоліки: потребує типізованого ALS provider і дисципліни ініціалізації;
  поза HTTP-контекстом store може бути порожнім.

### Option 2: `nestjs-cls` або інший CLS-пакет

- Переваги: готова NestJS інтеграція та зручні API/decorators.
- Недоліки: окрема залежність; власний infrastructure-код частково прихований
  за абстракцією; для поточного невеликого scope абстракція не є необхідною.

### Option 3: Request-scoped providers

- Переваги: контекст доступний через звичайний NestJS DI.
- Недоліки: request scope поширюється на залежні providers; singleton-сервіси
  можуть потребувати request-scoped lifecycle і створювати додаткові витрати.

### Option 4: Явне передавання context object

- Переваги: сигнатури явно показують context dependency.
- Недоліки: прямо протилежний вимозі не протягувати ID через усі рівні;
  збільшує coupling і громіздкість signatures.

## Decision Outcome

Використовувати native `AsyncLocalStorage` із типізованим NestJS service.
HTTP middleware створює UUID `businessProcessId` і запускає async chain через
`als.run(store, next)`. `businessProcessId` повертається в header
`X-Business-Process-Id`.

Singleton DI logger читає поточний store і додає ID до кожного log entry.
Після автентифікації `userId` також може бути доданий до store для логування.
Authorization не покладається лише на ALS: authenticated principal передається
через NestJS guards і context/decorator.

## Positive Consequences

- ID автоматично поширюється controllers → services → repositories → SQL logs.
- Не потрібно передавати ID через усі method signatures.
- Відсутня додаткова dependency для контексту запиту.
- Логування залишає один узгоджений механізм для HTTP і database operations.

## Negative Consequences

- Потрібна самостійна ініціалізація і захист від несинхронізованих callback.
- Позапроцесний або фоновий work потребує окремого context initialization.
- Код має перевіряти відсутність store, щоб не записувати `undefined`.

## Risks and Mitigations

- Витік контексту між запитами зменшується створенням нового store на кожен
  middleware invocation і уникненням singleton Mutable Store.
- Відсутність ALS-контексту поза HTTP обробляється fallback
  `UNSET-BUSINESS-PROCESS` або окремим startup context без секретів.
- Неправильне використання user identity для authorization уникне явним auth
  principal/guard; ALS використовується переважно для технічного контексту.
- Втрата ID в repositories перевіряється логами та тестами кожного рівня.

## Implications for Architecture

- Модулі: middleware доступний глобально, а logger injected через Nest DI.
- Дані: database logs отримують тот самий `businessProcessId`.
- Інтеграції: HTTP, SQL і exception logging читають один request store.
- Безпека: ALS не замінює guard, cookie-сесію або role checks.
- Експлуатація: всі пов’язані записи пошукові за UUID одного запиту.

## Confirmation

Перевірити, що HTTP-запит має один ID у response header і в логах controller,
service, repository і database; два паралельні запити не перетинають store;
запит поза ALS не записує порожній або чужий ID.

## References

- [Spec 02](../specs/02-implementation.md)
- [NestJS Async Local Storage documentation](https://docs.nestjs.com/recipes/async-local-storage)
