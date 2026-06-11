import type { Category, Role } from "@pawlog/shared";

export interface Messages {
  appName: string;
  tagline: string;
  signInWithGoogle: string;
  signInDev: string;
  logout: string;
  loading: string;
  greeting: (name: string) => string;
  comingSoon: string;
  categories: Record<Category, string>;
  common: {
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    add: string;
    close: string;
    back: string;
    retry: string;
    today: string;
    yesterday: string;
    confirm: string;
    optional: string;
    showMore: string;
  };
  nav: {
    home: string;
    calendar: string;
    log: string;
    health: string;
    settings: string;
    addActivity: string;
  };
  shell: {
    petSwitcher: string;
    mainNav: string;
  };
  errors: {
    title: string;
    body: string;
    notFound: string;
  };
  health: {
    soonTitle: string;
    soonBody: string;
  };
  login: {
    authError: string;
  };
  onboarding: {
    title: string;
    intro: string;
    cta: string;
  };
  pets: {
    yourPets: string;
    addPet: string;
    name: string;
    nameRequired: string;
    species: string;
    speciesDog: string;
    speciesCat: string;
    speciesOther: string;
    breed: string;
    sex: string;
    sexMale: string;
    sexFemale: string;
    sexUnknown: string;
    birthday: string;
    changePhoto: string;
    photoTooLarge: string;
    archive: string;
    unarchive: string;
    archivedBadge: string;
    targetsTitle: string;
    targetsHint: string;
    foodTarget: string;
    waterTarget: string;
    saved: string;
    role: Record<Role, string>;
  };
  add: {
    pickCategory: string;
    time: string;
    memo: string;
    photos: string;
    addPhotos: string;
    photoTooLarge: (name: string) => string;
    photoLimit: string;
    uploadingPhoto: (current: number, total: number) => string;
    saved: string;
    requiredField: (field: string) => string;
    detailsInvalid: string;
  };
  fields: {
    name: string;
    foodType: string;
    amount: string;
    unit: string;
    leftoverPct: string;
    amountMl: string;
    kind: string;
    condition: string;
    colorNote: string;
    kg: string;
    durationMin: string;
    distanceKm: string;
    severity: string;
    dose: string;
    doseUnit: string;
    clinic: string;
    reason: string;
    diagnosis: string;
    nextVisitDate: string;
    vaccineName: string;
    nextDueDate: string;
  };
  options: {
    foodType: Record<"dry" | "wet" | "treat" | "supplement", string>;
    unit: Record<"g" | "ml" | "pieces", string>;
    toiletKind: Record<"pee" | "poop", string>;
    condition: Record<"normal" | "soft" | "diarrhea" | "hard" | "bloody", string>;
    exerciseKind: Record<"walk" | "play" | "other", string>;
    severity: Record<"mild" | "moderate" | "severe", string>;
    groomingKind: Record<"bath" | "brush" | "nails" | "trim" | "other", string>;
  };
  quickAdd: {
    title: string;
    logged: (label: string) => string;
    undo: string;
    undone: string;
    emptyTitle: string;
    emptyHint: string;
    manage: string;
  };
}
