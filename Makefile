.DEFAULT_GOAL := help

.PHONY: help install dev start build test smoke typecheck lint format format-check verify db-up db-down db-migrate

help:
	@echo Available targets:
	@echo   install       Install locked dependencies (npm ci)
	@echo   dev           Start the development server
	@echo   start         Start the built application
	@echo   build         Build the application with commit metadata
	@echo   test          Run the current automated test suite
	@echo   smoke         Run the HTTP smoke test
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

test: build
	npm run smoke:test

smoke: build
	npm run smoke:test

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
