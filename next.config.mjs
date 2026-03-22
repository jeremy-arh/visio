/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "jlizwheftlnhoifbqeex.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  webpack: (config) => {
    // pdfjs-dist tente d'importer 'canvas' en environnement Node.js : on l'ignore côté serveur
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
