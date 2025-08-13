FROM node:23.11.0-alpine

# Установка зависимостей для работы с PDF и другими форматами
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

# Создание рабочей директории
WORKDIR /app

# Копирование package.json и package-lock.json
COPY package*.json ./

# Установка зависимостей
RUN npm ci --only=production

# Копирование исходного кода
COPY . .

# Генерация Prisma client (закомментировано до настройки схемы)
# RUN npx prisma generate

# Сборка приложения
RUN npm run build

# Создание пользователя для безопасности
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Смена владельца файлов
USER nestjs

# Экспорт порта
EXPOSE 3000

# Команда запуска
CMD ["node", "dist/main"]