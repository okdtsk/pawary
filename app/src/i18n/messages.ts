import type { Category } from "@pawlog/shared";

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
}
