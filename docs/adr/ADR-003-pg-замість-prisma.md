# ADR-003: `pg` і параметризований SQL замість Prisma

- Status: Accepted
- Date: 2026-11-20
- Deciders: Проєкт AutobusUA
- Technical area: Доступ до PostgreSQL
- Related requirements: `docs/specs/02-implementation.md`, `docs/er-diagram.md`
- Supersedes: N/A
- Superseded by: N/A

## Context and Problem Statement

Для лабораторної 2 потрібно реалізувати PostgreSQL storage через repositories
після статичного прототипу. Схема проєкту невелика, а основні складні сценарії —
конкурентна купівля, скасування квитка, ідемпотентність і отримання пов’язаних
даних списків. Потрібно вибрати інструмент доступу до БД.

## Decision Drivers

- Невеликий і зрозумілий обсяг моделі даних.
- Прямий контроль над транзакціями та `SELECT ... FOR UPDATE`.
- Мінімізація кількості runtime- і dev-залежностей.
- Можливість явно оптимізувати JOIN-запити і уникати N+1.
- Спільні repository contracts для статичного сховища та PostgreSQL.

## Considered Options

### Option 1: `pg` і параметризований SQL

- Переваги: прямий контроль над клієнтом транзакції, блокуванням рядків,
  JOIN-запитами, таймаутами та PostgreSQL error codes; менше проміжних
  залежностей; SQL залишений очевидним у repository method.
- Недоліки: mapping SQL-рядків у TypeScript types і міграції підтримуються
  вручну; немає автоматично згенерованого ORM client.

### Option 2: Prisma

- Переваги: типізований client, schema, міграції та зручні CRUD-операції.
- Недоліки: ORM додає додаткові залежності і кодогенерацію; точний контроль
  конкурентних транзакцій і PostgreSQL-специфічних запитів потребує raw SQL;
  для невеликої моделі переваги генерації schema/client не компенсують
  додаткову складність і залежності.

### Option 3: Query builder

- Переваги: може дати частковий type safety та центральне формування запитів.
- Недоліки: додає нову бібліотеку й абстракцію без суттєвої потреби в проекті;
  для найважливіших конкурентних сценаріїв контроль над SQL все одно повинен
  залишатися явним.

## Decision Outcome

Використовувати `pg` із параметризованими SQL-запитами в PostgreSQL
repositories. Міграції зберігати окремими SQL-файлами. Connection pool
створюється при startup і передається repositories через DI.

Усі SQL-запити із зовнішніми значеннями є параметризованими. Транзакції
використовують один client до `COMMIT` або `ROLLBACK`. `SELECT ... FOR UPDATE`
для купівлі та скасування записується явно.

## Positive Consequences

- Повний контроль над конкурентними операціями та пов’язаними транзакціями.
- Менше абстракцій і залежностей, ніж при ORM.
- SQL для list queries можна оптимізувати через цільові JOIN-и.
- Database error codes обробляються безпосередньо на repository boundary.

## Negative Consequences

- Mapping результатів і SQL-типів треба реалізувати і перевіряти вручну.
- Міграції не отримують ORM schema tooling.
- Розробнику потрібна дисципліна параметризованих запитів і SQL review.

## Risks and Mitigations

- Ризик SQL injection зменшується parameterized queries і забороною
  конкатенації значень у SQL.
- Ризик N+1 зменшується JOIN-запитами та перевіркою кількості SQL у тестах.
- Ризик розбіжності migration/state зменшується однією узгодженою міграційною
  директорією та перевіркою чистої тестової БД.
- Ризик помилок транзакцій зменшується transaction helper, обов’язковим
  rollback і release під час кожного завершення.

## Implications for Architecture

- Модулі: repositories є єдиною точкою SQL у кожному модулі.
- Дані: PostgreSQL schema, SQL migration files і TypeScript result mapping.
- Інтеграції: `pg` pool injected у repositories.
- Безпека: SQL-кодування параметрів і класифікація PostgreSQL SQLSTATE.
- Експлуатація: pool перевіряється через `SELECT now()` і закривається при
  shutdown.

## Confirmation

Перевірити clean migration на окремій тестовій БД, конкурентну купівлю,
транзакційний rollback/release, list queries без N+1 і відсутність SQL
інтерполяції із зовнішніх значень.

## References

- [Spec 02](../specs/02-implementation.md)
- [ER diagram](../er-diagram.md)
