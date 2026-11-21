.DEFAULT_GOAL := help

.PHONY: help install dev start build test coverage smoke mutation typecheck lint format format-check verify db-up db-down db-migrate

help:
	@echo Available targets:
	@echo   install       Install locked dependencies (npm ci)
	@echo   dev           Start the development server
	@echo   start         Start the built application
	@echo   build         Build the application with commit metadata
	@echo   test          Start PostgreSQL, migrate, and run unit/integration/E2E tests
	@echo   coverage      Check CarriersService logical branch coverage
	@echo   smoke         Run E2E smoke tests against the test database
	@echo   mutation      Run scoped Stryker mutation testing
	@echo   typecheck     Type-check application and tests
	@echo   lint          Run ESLint
	@echo   format        Format project files
	@echo   format-check  Check project formatting
	@echo   verify        Run the complete verification pipeline
	@echo   db-up         Start the local PostgreSQL service
	@echo   db-down       Stop local services without removing database data
	@echo   db-migrate    Apply pending PostgreSQL migrations

install:
	npm ci

dev:
	npm run start:dev

start:
	npm start

build:
	npm run build

test:
	docker compose up -d --wait postgres
	npm run db:migrate:test
	npm run test:unit
	npm run test:integration
	npm run test:e2e

coverage:
	npm run test:coverage:carriers

smoke:
	docker compose up -d --wait postgres
	npm run db:migrate:test
	npm run smoke:test

mutation:
	npm run mutation

typecheck:
	npm run typecheck

lint:
	npm run lint

format:
	npm run format

format-check:
	npm run format:check

verify:
	npm run verify

db-up:
	docker compose up -d postgres

db-down:
	docker compose down

db-migrate:
	npm run db:migrate
