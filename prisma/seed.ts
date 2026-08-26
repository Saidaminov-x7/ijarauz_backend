// prisma/seed.ts
/**
 * Скрипт безопасного начального наполнения базы данных (Safe Idempotent Seed)
 * Безопасен для запуска на проде: использует upsert, НЕ удаляет существующие данные пользователей,
 * объявлений или кастомных настроек конструктора страниц.
 * Запуск: pnpm prisma:seed (или npx tsx prisma/seed.ts)
 */

import { PrismaClient, Role, AdminRole } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting safe idempotent database seed...');

  // Хэширование пароля супер-администратора (argon2 hash)
  const superAdminPasswordHash = await argon2.hash('admin1');

  // ─── 1. Супер-администратор (upsert: безопасен для существующих данных) ───────
  console.log('Ensuring Super Admin account exists...');

  const superAdmin = await prisma.user.upsert({
    where: { email: 'vosilhojasaidaminov@gmail.com' },
    update: {
      role: Role.ADMIN,
      adminRole: AdminRole.SUPER_ADMIN,
      passwordHash: superAdminPasswordHash,
    },
    create: {
      email: 'vosilhojasaidaminov@gmail.com',
      phone: '+998900000001',
      passwordHash: superAdminPasswordHash,
      name: 'Восил Хожасаидаминов',
      role: Role.ADMIN,
      adminRole: AdminRole.SUPER_ADMIN,
      verified: true,
    },
  });

  // ─── 2. Настройки сайта (singleton: не перезаписывает изменённые настройки) ────
  console.log('Ensuring SiteSettings singleton exists...');

  await prisma.siteSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      maintenanceMode: false,
      maintenanceMessage: 'Сайт временно недоступен. Мы проводим технические работы. Попробуйте позже.',
      siteName: 'Ijarauz',
      contactEmail: 'support@ijarauz.uz',
      contactPhone: '+998 71 200-00-00',
      googleAuthEnabled: true,
      autoModerationEnabled: false,
      maxImagesPerListing: 10,
      updatedById: superAdmin.id,
    },
  });

  // ─── 3. Стартовые секции конструктора (создаются ТОЛЬКО если секций ещё нет) ──
  const existingSectionsCount = await prisma.pageSection.count({
    where: { pageKey: 'home' },
  });

  if (existingSectionsCount === 0) {
    console.log('Creating initial default PageSections for Home page...');

    const defaultHomeSections = [
      {
        pageKey: 'home',
        sectionType: 'HERO_SEARCH',
        title: 'Главный баннер с поиском',
        order: 0,
        isVisible: true,
        content: {
          title: 'Аренда жилья в Узбекистане без посредников',
          subtitle: 'Найдите идеальную квартиру, дом или комнату напрямую от собственников по всему Узбекистану',
          showSearch: true,
          searchPlaceholder: 'Район, метро, улица или город...',
          quickFilters: [
            { label: 'Студии', href: '/catalog?type_apartments=studio' },
            { label: '1-комнатные', href: '/catalog?rooms=1' },
            { label: 'Дома и участки', href: '/catalog?type=house' },
            { label: 'Возле метро', href: '/catalog?near_metro=true' },
            { label: 'Без комиссии', href: '/catalog?commission=false' },
          ],
        },
      },
      {
        pageKey: 'home',
        sectionType: 'BENEFITS',
        title: 'Честные преимущества',
        order: 1,
        isVisible: true,
        content: {
          title: 'Почему выбирают ijarauz',
          items: [
            {
              title: 'Прямой контакт с собственниками',
              text: 'Все объявления проходят модерацию. Никаких скрытых комиссий риелторов.',
              icon: 'ShieldCheck',
            },
            {
              title: 'Удобный поиск по карте',
              text: 'Выбирайте жилье рядом с работой, учебой или станциями метро на интерактивной карте.',
              icon: 'Map',
            },
            {
              title: 'Безопасное общение',
              text: 'Встроенный чат с проверкой истории и защитой от спама и мошенников.',
              icon: 'MessagesSquare',
            },
          ],
        },
      },
      {
        pageKey: 'home',
        sectionType: 'POPULAR_LISTINGS',
        title: 'Популярные предложения',
        order: 2,
        isVisible: true,
        content: {
          title: 'Популярные объявления',
          subtitle: 'Свежие предложения аренды',
          viewAllText: 'Смотреть все',
          limit: 6,
        },
      },
      {
        pageKey: 'home',
        sectionType: 'CTA_BANNER',
        title: 'Баннер сдачи жилья',
        order: 3,
        isVisible: true,
        content: {
          title: 'Сдайте жильё выгодно и быстро',
          text: 'Разместите объявление бесплатно за 2 минуты и найдите надежных арендаторов уже сегодня',
          buttonText: 'Разместить объявление',
          buttonLink: '/add-listing',
        },
      },
      {
        pageKey: 'home',
        sectionType: 'CATEGORIES',
        title: 'Категории жилья',
        order: 4,
        isVisible: true,
        content: {
          title: 'Категории жилья',
          categories: [
            { name: 'Посуточно', icon: 'Key', href: '/catalog?rental_type=daily' },
            { name: 'Новостройки', icon: 'Building2', href: '/catalog?building_type=new' },
            { name: 'Элитные', icon: 'Sparkles', href: '/catalog?class=elite' },
            { name: 'Для студентов', icon: 'Home', href: '/catalog?for_whom=students' },
            { name: 'Долгосрочно', icon: 'Building', href: '/catalog?rental_type=long' },
            { name: 'Студии', icon: 'Home', href: '/catalog?type_apartments=studio' },
          ],
        },
      },
    ];

    for (const sec of defaultHomeSections) {
      await prisma.pageSection.create({
        data: {
          ...sec,
          updatedById: superAdmin.id,
        },
      });
    }
  } else {
    console.log(`Skipping PageSections creation (${existingSectionsCount} sections already exist).`);
  }

  console.log('✅ Safe Seed completed successfully!');
  console.log('');
  console.log('--- Аккаунт администратора ---');
  console.log(`Email:    vosilhojasaidaminov@gmail.com`);
  console.log(`Пароль:   admin1 (хэширован в базе данных через argon2)`);
  console.log(`Роль:     SUPER_ADMIN`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
