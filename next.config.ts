import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // REVIEW.md F23 (Medium): pre-empt the next/image trap for Cloudinary URLs.
  // BOILER v2 stores flat_artwork_url on res.cloudinary.com; today the
  // renderer uses raw <img> via next/image with unoptimized — but the first
  // contributor who writes `<Image src={cloudinaryUrl}>` without unoptimized
  // would hit a Next 500 (default-deny on remote hosts). Tells Next the host
  // is trusted now so the obvious next step doesn't bite.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
};

export default nextConfig;
