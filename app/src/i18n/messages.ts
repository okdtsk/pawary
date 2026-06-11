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
}
