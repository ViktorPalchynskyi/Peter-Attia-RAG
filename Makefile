docker-build: ## Build Docker image
	docker compose build

docker-up: ## Start Docker containers
	docker compose --env-file .env up --build -d

docker-down: ## Stop Docker containers
	docker compose down

docker-restart: ## Restart Docker containers
	docker compose down && docker compose --env-file .env up --build -d

docker-logs: ## View Docker logs
	docker compose logs -f