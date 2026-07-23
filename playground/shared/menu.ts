// Data model for the "menu" showcase: a two-page A5 dinner menu for the
// fictional alpine restaurant Gasthaus Alpenrose. Dish names are German (to
// exercise umlaut/diacritic round-tripping) with English descriptions; prices
// are plain EUR numbers formatted with a comma, the way an Austrian menu reads.

export interface MenuDish {
  /** German dish name, set in Inter 600. */
  name: string
  /** One-line English description, set in Lora italic. */
  description: string
  /** Price in Euro. */
  price: number
}

/** Stable ids for the three dish courses — literal so the outline map is exact. */
export type MenuCourseId = 'starters' | 'mains' | 'desserts'

export interface MenuCourse {
  /** Stable id for the outline/bookmark. */
  id: MenuCourseId
  /** Small-caps section head, e.g. "Vorspeisen · Starters". */
  label: string
  dishes: MenuDish[]
}

export interface MenuWine {
  name: string
  /** Growing region. */
  region: string
  /** Vintage. */
  year: number
  /** Price by the glass. */
  glass: number
  /** Price by the bottle. */
  bottle: number
}

export interface MenuWineList {
  id: string
  label: string
  entries: MenuWine[]
}

export interface Menu {
  name: string
  /** One-line ethos, set in Lora italic under the name. */
  ethos: string
  /** Small establishment line, e.g. "Serviert seit 1912". */
  established: string
  /** Footer note about pricing, e.g. inclusive of VAT. */
  priceNote: string
  starters: MenuCourse
  mains: MenuCourse
  desserts: MenuCourse
  wines: MenuWineList
}

/** Format a Euro amount the Austrian way: two decimals, comma separator. */
export const formatMenuPrice = (value: number): string =>
  value.toFixed(2).replace('.', ',')

/** Format a wine bottle price: whole Euro, no decimals when round. */
export const formatWinePrice = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',')

export const sampleMenu: Menu = {
  name: 'Gasthaus Alpenrose',
  ethos: 'Küche aus den Bergen — honest cooking from the high valleys.',
  established: 'Familienbetrieb seit 1912 · St. Ulrich am Grödnerhof',
  priceNote: 'Alle Preise in Euro, inklusive Bedienung und Mehrwertsteuer.',
  starters: {
    id: 'starters',
    label: 'Vorspeisen · Starters',
    dishes: [
      {
        name: 'Kürbiscremesuppe',
        description: 'Roasted Hokkaido squash, brown butter, toasted seeds.',
        price: 9.5,
      },
      {
        name: 'Geräucherte Bergforelle',
        description: 'Smoked alpine trout, horseradish cream, pickled cucumber.',
        price: 12,
      },
      {
        name: 'Käsespätzle im Pfännchen',
        description: 'Handmade egg noodles, aged mountain cheese, crisp onions.',
        price: 11.5,
      },
      {
        name: 'Rote-Bete-Carpaccio',
        description: 'Marinated beetroot, goat cheese, walnut, aged balsamic.',
        price: 10,
      },
    ],
  },
  mains: {
    id: 'mains',
    label: 'Hauptgerichte · Mains',
    dishes: [
      {
        name: 'Rehragout mit Preiselbeeren',
        description: 'Braised venison, juniper, hand-cut spätzle, lingonberry.',
        price: 26.5,
      },
      {
        name: 'Wiener Schnitzel vom Kalb',
        description: 'Breaded veal cutlet, parsley potatoes, cranberry.',
        price: 24,
      },
      {
        name: 'Tafelspitz vom Weiderind',
        description: 'Simmered pasture beef, root vegetables, chive sauce, rösti.',
        price: 25,
      },
      {
        name: 'Krautfleckerl mit Räuchertofu',
        description: 'Caramelised cabbage, egg noodles, smoked tofu.',
        price: 18,
      },
    ],
  },
  desserts: {
    id: 'desserts',
    label: 'Nachspeisen · Desserts',
    dishes: [
      {
        name: 'Kaiserschmarrn',
        description: 'Caramelised shredded pancake, plum compote, icing sugar.',
        price: 9.5,
      },
      {
        name: 'Topfenknödel',
        description: 'Quark dumplings, buttered crumbs, apricot ragout.',
        price: 8.5,
      },
      {
        name: 'Schokoladensoufflé',
        description: 'Warm dark chocolate, salted caramel, crème fraîche.',
        price: 10,
      },
      {
        name: 'Apfelstrudel mit Vanillesauce',
        description: 'Apple strudel, raisins, cinnamon, warm vanilla sauce.',
        price: 8,
      },
    ],
  },
  wines: {
    id: 'wines',
    label: 'Weinkarte · Wine',
    entries: [
      { name: 'Grüner Veltliner Federspiel', region: 'Wachau', year: 2023, glass: 6.5, bottle: 32 },
      { name: 'Riesling Smaragd', region: 'Wachau', year: 2021, glass: 8, bottle: 44 },
      { name: 'Sauvignon Blanc', region: 'Südsteiermark', year: 2023, glass: 7, bottle: 34 },
      { name: 'Blaufränkisch Reserve', region: 'Mittelburgenland', year: 2020, glass: 7.5, bottle: 38 },
      { name: 'Zweigelt vom Kalkboden', region: 'Kamptal', year: 2022, glass: 6, bottle: 29 },
      { name: 'Sankt Laurent', region: 'Thermenregion', year: 2021, glass: 7.5, bottle: 36 },
    ],
  },
}

// A meaningful alternate: the winter card. Same structure, different dishes and
// pours — proves the template is fully data-driven, not hard-coded copy.
export const winterMenu: Menu = {
  name: 'Gasthaus Alpenrose',
  ethos: 'Winterküche — long braises for short days.',
  established: 'Familienbetrieb seit 1912 · St. Ulrich am Grödnerhof',
  priceNote: 'Alle Preise in Euro, inklusive Bedienung und Mehrwertsteuer.',
  starters: {
    id: 'starters',
    label: 'Vorspeisen · Starters',
    dishes: [
      {
        name: 'Maroni-Schaumsuppe',
        description: 'Chestnut velouté, smoked bacon crumble, sage oil.',
        price: 9.5,
      },
      {
        name: 'Gebeizter Saibling',
        description: 'Cured char, fennel, blood orange, dill crème fraîche.',
        price: 12.5,
      },
      {
        name: 'Ochsenschlepp-Consommé',
        description: 'Clear oxtail broth, marrow dumpling, root vegetables.',
        price: 10.5,
      },
    ],
  },
  mains: {
    id: 'mains',
    label: 'Hauptgerichte · Mains',
    dishes: [
      {
        name: 'Geschmorte Ochsenbäckchen',
        description: 'Braised ox cheeks, red wine jus, celeriac purée.',
        price: 27,
      },
      {
        name: 'Hirschkalbsrücken',
        description: 'Roasted venison loin, quince, chestnut, dark chocolate jus.',
        price: 29.5,
      },
      {
        name: 'Wurzelgemüse-Strudel',
        description: 'Root-vegetable strudel, aged cheese, brown-butter crumbs.',
        price: 19,
      },
    ],
  },
  desserts: {
    id: 'desserts',
    label: 'Nachspeisen · Desserts',
    dishes: [
      {
        name: 'Gebrannte Vanillecreme',
        description: 'Burnt vanilla custard, spiced plum, hazelnut brittle.',
        price: 9,
      },
      {
        name: 'Mohnnudeln',
        description: 'Poppy-seed potato noodles, brown butter, pear compote.',
        price: 8.5,
      },
      {
        name: 'Lebkuchenparfait',
        description: 'Gingerbread parfait, mulled-wine cherries, orange.',
        price: 9.5,
      },
    ],
  },
  wines: {
    id: 'wines',
    label: 'Weinkarte · Wine',
    entries: [
      { name: 'Blaufränkisch Reserve', region: 'Mittelburgenland', year: 2019, glass: 8, bottle: 42 },
      { name: 'Pinot Noir Réserve', region: 'Burgenland', year: 2020, glass: 8.5, bottle: 46 },
      { name: 'Grüner Veltliner Smaragd', region: 'Wachau', year: 2022, glass: 7.5, bottle: 39 },
      { name: 'Sankt Laurent vom Fels', region: 'Thermenregion', year: 2020, glass: 8, bottle: 40 },
    ],
  },
}
