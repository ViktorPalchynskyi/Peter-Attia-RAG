.PHONY: help dev prod build up down restart logs clean install

# Переменные
COMPOSE_FILE_DEV = docker-compose.dev.yml
COMPOSE_FILE_PROD = docker-compose.yml

help: ## Показать список доступных команд
	@echo "Доступные команды:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Команды для разработки (с hot reload)
dev: ## Запустить проект в режиме разработки с hot reload
	docker compose -f $(COMPOSE_FILE_DEV) up --build

dev-build: ## Собрать Docker image для разработки
	docker compose -f $(COMPOSE_FILE_DEV) build

dev-up: ## Запустить контейнеры в режиме разработки в фоне
	docker compose -f $(COMPOSE_FILE_DEV) up --build -d

dev-down: ## Остановить контейнеры разработки
	docker compose -f $(COMPOSE_FILE_DEV) down

dev-restart: ## Перезапустить контейнеры разработки
	docker compose -f $(COMPOSE_FILE_DEV) down && docker compose -f $(COMPOSE_FILE_DEV) up --build -d

dev-logs: ## Показать логи разработки
	docker compose -f $(COMPOSE_FILE_DEV) logs -f

# Команды для production
prod: ## Запустить проект в production режиме
	docker compose -f $(COMPOSE_FILE_PROD) up --build

prod-build: ## Собрать Docker image для production
	docker compose -f $(COMPOSE_FILE_PROD) build

prod-up: ## Запустить контейнеры в production в фоне
	docker compose -f $(COMPOSE_FILE_PROD) up --build -d

prod-down: ## Остановить production контейнеры
	docker compose -f $(COMPOSE_FILE_PROD) down

prod-restart: ## Перезапустить production контейнеры
	docker compose -f $(COMPOSE_FILE_PROD) down && docker compose -f $(COMPOSE_FILE_PROD) up --build -d

prod-logs: ## Показать production логи
	docker compose -f $(COMPOSE_FILE_PROD) logs -f

# Универсальные команды (используют dev по умолчанию)
build: dev-build ## Alias для dev-build

up: dev-up ## Alias для dev-up

down: dev-down ## Alias для dev-down

restart: dev-restart ## Alias для dev-restart

logs: dev-logs ## Alias для dev-logs

# Утилиты
clean: ## Очистить все Docker ресурсы проекта
	docker compose -f $(COMPOSE_FILE_DEV) down -v --rmi all --remove-orphans
	docker compose -f $(COMPOSE_FILE_PROD) down -v --rmi all --remove-orphans
	docker system prune -f

install: ## Установить зависимости локально
	npm install

test: ## Запустить тесты в контейнере
	docker compose -f $(COMPOSE_FILE_DEV) exec app npm run test

lint: ## Запустить линтер в контейнере
	docker compose -f $(COMPOSE_FILE_DEV) exec app npm run lint

shell: ## Подключиться к shell контейнера разработки
	docker compose -f $(COMPOSE_FILE_DEV) exec app sh

health: ## Проверить здоровье приложения
	curl -f http://localhost:3000/health || echo "Сервис недоступен"

# Команды для базы данных (когда настроим Prisma)
# db-migrate: ## Применить миграции БД
# 	docker compose -f $(COMPOSE_FILE_DEV) exec app npx prisma migrate dev

# db-reset: ## Сбросить БД
# 	docker compose -f $(COMPOSE_FILE_DEV) exec app npx prisma migrate reset

# db-studio: ## Открыть Prisma Studio
# 	docker compose -f $(COMPOSE_FILE_DEV) exec app npx prisma studio