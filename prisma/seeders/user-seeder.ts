import * as argon from 'argon2';

export async function userSeeder(prisma) {
  const amgad = await prisma.user.upsert({
    where: { email: 'amgad@gmail.com' },
    update: {},
    create: {
      email: 'amgad@gmail.com',
      name: 'amgad alwattar',
      password: await argon.hash('amgad123'),
    },
  });
  const ayham = await prisma.user.upsert({
    where: { email: 'ayham@gmail.com' },
    update: {},
    create: {
      email: 'ayham@gmail.com',
      name: 'ayham hammami',
      password: await argon.hash('amgad123'),
    },
  });
}