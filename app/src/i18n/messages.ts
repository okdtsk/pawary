import type { Category, InsightsPeriod, Role, ScheduleType } from "@pawary/shared";

/** Audited entities/actions the catalogs must label — a missing combo fails typecheck. */
export type AuditEntity =
  | "activity"
  | "pet"
  | "schedule"
  | "preset"
  | "member"
  | "invite"
  | "advisor";
export type AuditAction = "create" | "update" | "delete";

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
    periods: Record<InsightsPeriod, string>;
    weightTitle: string;
    weightEmpty: string;
    movingAvg: string;
    pctChange: (pct: string) => string;
    intakeTitle: string;
    intakeEmpty: string;
    food: string;
    water: string;
    target: string;
    notLogged: string;
    gramsOnlyHint: string;
    toiletTitle: string;
    toiletEmpty: string;
    timelineTitle: string;
    timelineEmpty: string;
    vetVisits: string;
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
    removePhoto: string;
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
  members: {
    title: string;
    you: string;
    pendingTitle: string;
    expires: (date: string) => string;
    revoke: string;
    remove: string;
    removeConfirm: string;
    leave: string;
    leaveConfirm: string;
    lastOwner: string;
    inviteCreate: string;
    inviteRole: string;
    linkCopied: string;
    shareText: (pet: string) => string;
    joinTitle: string;
    joinPrompt: (pet: string, inviter: string) => string;
    joinAs: (role: string) => string;
    accept: string;
    decline: string;
    joined: string;
    alreadyMember: string;
    invalidTitle: string;
    invalidBody: string;
    goHome: string;
  };
  advisor: {
    title: string;
    homeCard: string;
    homeCardHint: string;
    disclaimer: string;
    newConversation: string;
    emptyTitle: string;
    emptyHint: string;
    listEmptyTitle: string;
    listEmptyHint: string;
    setupCta: string;
    inputPlaceholder: string;
    send: string;
    deleteConversation: string;
    deleteConfirm: string;
    viewerNote: string;
    errors: {
      provider_auth: string;
      provider_rate_limited: string;
      provider_overloaded: string;
      provider_model: string;
      provider_error: string;
      advisor_not_configured: string;
      rate_limited: string;
      offline: string;
      network: string;
      fallback: string;
    };
    settings: {
      title: string;
      intro: string;
      provider: string;
      model: string;
      apiKey: string;
      apiKeyHintPrefix: string;
      apiKeyHintLink: string;
      apiKeyConfigured: string;
      saved: string;
      remove: string;
      removeConfirm: string;
      test: string;
      testSuccess: string;
    };
  };
  add: {
    pickCategory: string;
    time: string;
    pickerDate: string;
    pickerHour: string;
    pickerMinute: string;
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
  home: {
    greeting: (petName: string) => string;
    todaySoFar: string;
    quietTitle: string;
    quietHint: string;
  };
  calendar: {
    views: Record<"month" | "week" | "3day" | "day", string>;
    previous: string;
    next: string;
    dayEmpty: string;
    settings: {
      title: string;
      weekendColor: string;
      startHour: string;
      timezone: string;
      timezoneSystem: string;
    };
  };
  log: {
    searchPlaceholder: string;
    filterLabel: string;
    emptyTitle: string;
    emptyHint: string;
  };
  detail: {
    updated: string;
    deleted: string;
    deleteTitle: string;
    deleteBody: string;
    viewPhoto: string;
  };
  settings: {
    displayName: string;
    language: string;
    languageSystem: string;
    saved: string;
    presets: string;
    account: string;
    exportTitle: string;
    exportAll: string;
    exportPetJson: (petName: string) => string;
    exportPetCsv: (petName: string) => string;
    newPreset: string;
    presetLabel: string;
    presetCreated: string;
    moveUp: string;
    moveDown: string;
    signedInAs: string;
    dangerTitle: string;
    dangerBody: string;
    confirmEmailLabel: (email: string) => string;
    deleteAccount: string;
  };
  care: {
    title: string;
    addSchedule: string;
    editSchedule: string;
    emptyTitle: string;
    emptyHint: string;
    types: Record<ScheduleType, string>;
    typeLabel: string;
    nameLabel: string;
    categoryLabel: string;
    repeatLabel: string;
    everyLabel: string;
    firstDueLabel: string;
    endLabel: string;
    endHint: string;
    recurrence: {
      once: string;
      hours: (n: number) => string;
      days: (n: number) => string;
      weeks: (n: number) => string;
      months: (n: number) => string;
    };
    overdue: string;
    dueToday: (time: string) => string;
    dueIn: (days: number) => string;
    finishedBadge: string;
    complete: string;
    completed: (name: string) => string;
    undo: string;
    undone: string;
    deleteSchedule: string;
    deleteConfirm: string;
    created: string;
    saved: string;
    homeTitle: string;
    homeAllDone: string;
    seeAll: string;
    nameRequired: string;
    invalidEnd: string;
    invalidN: string;
  };
  anomalies: {
    weightDrift: (pct: string) => string;
    toiletTrouble: (count: number) => string;
    quietDay: (petName: string) => string;
    symptomStreak: (name: string, days: number) => string;
    advice: string;
    dismiss: string;
    view: string;
  };
  pwa: {
    updateReady: string;
    reload: string;
    offline: string;
    offlineWrite: string;
    iosInstallTitle: string;
    iosInstallBody: string;
    pullToRefresh: string;
    releaseToRefresh: string;
    refreshing: string;
  };
  push: {
    title: string;
    enable: string;
    disable: string;
    enabledStatus: string;
    unsupported: string;
    denied: string;
    iosInstallHint: string;
    error: string;
  };
  audit: {
    title: string;
    formerMember: string;
    empty: string;
    history: string;
    lines: Record<AuditEntity, Record<AuditAction, string>>;
  };
}
