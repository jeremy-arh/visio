/** Public logo (Supabase Storage). */
export const MY_NOTARY_LOGO_SRC =
  typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/assets/logo/logo-noir.svg`
    : "https://jlizwheftlnhoifbqeex.supabase.co/storage/v1/object/public/assets/logo/logo-noir.svg";
