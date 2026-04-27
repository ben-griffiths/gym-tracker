import type { NextConfig } from "next";

/**
 * LAN device testing (e.g. phone at http://YOUR_LAN_IP:3000): Next.js blocks
 * cross-origin webpack HMR requests unless the page host is listed here.
 * Duplicate the entry or swap the IP when your DHCP address changes.
 */
const allowedDevOrigins = ["192.168.1.183"];

const nextConfig: NextConfig = {
  allowedDevOrigins,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
