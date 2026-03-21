/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // pdfjs-dist tente d'importer 'canvas' en environnement Node.js : on l'ignore côté serveur
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
