// Shared by Dialog and Sheet so the scrim stays in sync.
export const overlayClassName =
  "fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--color-vault)_72%,transparent)] backdrop-blur-[7px] max-md:backdrop-blur-none transition-opacity duration-200 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150";
