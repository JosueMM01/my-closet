'use client';

/**
 * Datos de ejemplo con fotografías locales (public/demo, Unsplash License).
 * Permite poblar el armario para probar la UI con fotos reales.
 */
import type { LocalProfile } from '@/lib/domain/types';
import { saveGarmentPhoto } from '@/lib/images/image-client';
import { createCalendarEntry, createGarment, createOutfit } from '@/lib/local/repositories';
import { today } from '@/lib/domain/dates';

interface DemoGarment {
  file: string;
  name: string;
  category: string;
  colors: string[];
  brand: string | null;
  size: string | null;
}

const DEMO_GARMENTS: DemoGarment[] = [
  { file: 'tshirt-white.jpg', name: 'Camiseta blanca', category: 'tops', colors: ['white'], brand: 'Basic Co.', size: 'M' },
  { file: 'blouse-beige.jpg', name: 'Blusa beige', category: 'tops', colors: ['beige'], brand: 'Mango', size: 'S' },
  { file: 'dress-floral.jpg', name: 'Vestido flores', category: 'dresses', colors: ['pattern', 'pink'], brand: 'Zara', size: 'M' },
  { file: 'denim-jacket.jpg', name: 'Cazadora vaquera', category: 'outerwear', colors: ['blue'], brand: "Levi's", size: 'M' },
  { file: 'trench-coat.jpg', name: 'Gabardina arena', category: 'outerwear', colors: ['beige'], brand: 'Massimo Dutti', size: 'L' },
  { file: 'knit-sweater.jpg', name: 'Suéter punto', category: 'tops', colors: ['grey'], brand: 'Uniqlo', size: 'M' },
  { file: 'leather-jacket.jpg', name: 'Chaqueta cuero', category: 'outerwear', colors: ['black', 'brown'], brand: 'Bershka', size: 'M' },
  { file: 'sneakers.jpg', name: 'Zapatillas blancas', category: 'footwear', colors: ['white'], brand: 'Nike', size: '38' },
  { file: 'boots.jpg', name: 'Botines', category: 'footwear', colors: ['brown'], brand: 'Dr. Martens', size: '38' },
  { file: 'handbag.jpg', name: 'Bolso camel', category: 'bags', colors: ['brown'], brand: 'Stradivarius', size: null },
];

export async function seedDemoData(profile: LocalProfile): Promise<void> {
  const createdIds: Record<string, string> = {};

  for (const demo of DEMO_GARMENTS) {
    let photoId: string | null = null;
    try {
      const response = await fetch(`/demo/${demo.file}`);
      if (response.ok) {
        const blob = await response.blob();
        const file = new File([blob], demo.file, { type: blob.type || 'image/jpeg' });
        const record = await saveGarmentPhoto(profile.userId, file);
        photoId = record.id;
      }
    } catch {
      // Sin foto igualmente creamos la prenda.
    }
    const garment = await createGarment(profile.userId, {
      name: demo.name,
      category: demo.category,
      colors: demo.colors,
      brand: demo.brand,
      size: demo.size,
      notes: 'Prenda de ejemplo',
      washingInstructions: null,
      dateAcquired: null,
      archived: false,
      photoId,
    });
    createdIds[demo.file] = garment.id;
  }

  await createOutfit(profile.userId, {
    name: 'Casual de fin de semana',
    notes: 'Look cómodo para el día a día',
    slots: [
      { category: 'tops', garmentId: createdIds['tshirt-white.jpg'] ?? null },
      { category: 'footwear', garmentId: createdIds['sneakers.jpg'] ?? null },
      { category: 'bags', garmentId: createdIds['handbag.jpg'] ?? null },
    ],
  });

  const outfit = await createOutfit(profile.userId, {
    name: 'Elegante de tarde',
    notes: null,
    slots: [
      { category: 'dresses', garmentId: createdIds['dress-floral.jpg'] ?? null },
      { category: 'outerwear', garmentId: createdIds['trench-coat.jpg'] ?? null },
      { category: 'footwear', garmentId: createdIds['boots.jpg'] ?? null },
    ],
  });

  await createCalendarEntry(profile.userId, {
    date: today(),
    outfitId: outfit.id,
    notes: null,
    wornAt: null,
  });
}
