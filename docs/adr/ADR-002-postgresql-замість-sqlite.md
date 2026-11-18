# ADR-002: PostgreSQL замість SQLite

- Status: Accepted
- Date: 2026-11-16
- Deciders: Проєкт AutobusUA
- Technical area: Зберігання даних
- Related requirements: `docs/specs/01-foundation.md`
- Supersedes: N/A
- Superseded by: N/A

## Context and Problem Statement

Система має конкурентну купівлю останнього доступного місця. Потрібна
реляційна база з транзакціями, блокуванням рядків і передбачуваною поведінкою
для кількох одночасних запитів. Після спрощення scope SQLite стала технічно
можливою, тому вибір потрібно зафіксувати явно.

## Decision Drivers

- Row-level locking для рейсу.
- Надійна конкурентна робота кількох backend-процесів.
- Транзакційна консистентність квитка та `occupiedSeats`.
- Docker-розгортання і сумісність із Prisma.

## Considered Options

### Option 1: PostgreSQL

- Переваги: row-level locking, `SELECT ... FOR UPDATE`, зріла конкурентність,
  незалежна серверна БД і відсутність глобальної серіалізації записів.
- Недоліки: окремий сервіс, складніше локальне налаштування та більші вимоги
  до ресурсів.

### Option 2: SQLite

- Переваги: файлова БД, просте налаштування і мінімум інфраструктури.
- Недоліки: обмеженіша конкурентність записів, lock/busy-помилки та
  непридатність як базовий варіант для кількох backend-процесів.

## Decision Outcome

Використовувати PostgreSQL як єдину цільову базу даних. Локальний запуск
виконується через Docker Compose. SQLite не є альтернативною production- або
test-ціллю.

## Positive Consequences

- Конкурентна купівля може використовувати `SELECT ... FOR UPDATE`.
- Поведінка локального й цільового середовища узгоджена.
- Можливе горизонтальне масштабування backend без заміни БД.

## Negative Consequences

- Для запуску потрібен контейнер PostgreSQL.
- Інтеграційні тести залежать від доступного PostgreSQL.

## Risks and Mitigations

- Складність запуску зменшується Docker Compose і healthcheck бази.
- Тести запускаються на PostgreSQL, а не на спрощеному SQLite-заміннику.

## Implications for Architecture

- Дані: Prisma schema і міграції орієнтовані на PostgreSQL.
- Транзакції: блокування рядка рейсу доступне в цільовій БД.
- Експлуатація: PostgreSQL запускається окремим Docker-контейнером.

## Confirmation

Перевірити міграції на чистій PostgreSQL, паралельну купівлю останнього місця
та запуск через Docker Compose.

## References

- [Spec 01](../specs/01-foundation.md)
- [ER diagram](../er-diagram.md)
