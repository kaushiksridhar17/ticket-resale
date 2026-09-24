import type { Role } from "./types";

export interface RoleCopy {
  role: Role;
  noun: string;
  signInHeading: string;
  signInBlurb: string;
  registerHeading: string;
  registerBlurb: string;
  home: string;
  canRegister: boolean;
}

export const ROLE_COPY: Record<Role, RoleCopy> = {
  customer: {
    role: "customer",
    noun: "Customer",
    signInHeading: "Welcome back",
    signInBlurb: "Sign in to claim a ticket, hold your place, or pass one on.",
    registerHeading: "Come in",
    registerBlurb:
      "An account here lets you claim a ticket at face value and keep your place in the queue when there are none left.",
    home: "/",
    canRegister: true,
  },
  seller: {
    role: "seller",
    noun: "Seller",
    signInHeading: "Seller sign in",
    signInBlurb: "Sign in to submit a ticket and see where your listings stand.",
    registerHeading: "Sell a ticket you cannot use",
    registerBlurb:
      "Submit the ticket with a photo of it. Somebody checks the photo before the ticket goes on sale, and it sells for what you paid.",
    home: "/",
    canRegister: true,
  },
  admin: {
    role: "admin",
    noun: "Admin",
    signInHeading: "Admin sign in",
    signInBlurb: "The account that runs the site.",
    registerHeading: "",
    registerBlurb: "",
    home: "/organize",
    canRegister: false,
  },
};

export function homeFor(role: Role): string {
  return ROLE_COPY[role].home;
}
