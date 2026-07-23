import React from "react";

interface DevHiveLogoProps {
  size?: number;
  showText?: boolean;
}

export const DevHiveLogo: React.FC<DevHiveLogoProps> = ({ size = 26, showText = true }) => {
  return (
    <div className="dev-hive-logo-container">
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="dev-hive-logo-icon"
      >
        <defs>
          <linearGradient id="hiveGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="50%" stopColor="#d97706" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>

          <linearGradient id="hiveGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>

          <filter id="hiveGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer Hexagon Frame */}
        <path
          d="M20 3 L35 11.66 V28.34 L20 37 L5 28.34 V11.66 Z"
          stroke="url(#hiveGrad1)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          fill="rgba(217, 119, 6, 0.08)"
        />

        {/* Inner Hive Lattice Details */}
        <path
          d="M20 3 V13 M35 11.66 L26.34 16.66 M35 28.34 L26.34 23.34 M20 37 V27 M5 28.34 L13.66 23.34 M5 11.66 L13.66 16.66"
          stroke="url(#hiveGrad1)"
          strokeWidth="1.2"
          strokeOpacity="0.4"
          strokeDasharray="2 2"
        />

        {/* Central Play Motion Hex Core */}
        <polygon points="16,14 27,20 16,26" fill="url(#hiveGrad1)" filter="url(#hiveGlow)" />
        
        {/* Decorative Motion Wave Rays */}
        <path
          d="M31 16 C33 18.5 33 21.5 31 24"
          stroke="url(#hiveGrad2)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      {showText && (
        <div className="dev-hive-text-group">
          <span className="dev-hive-brand-name">
            Dev Hive<span className="dev-hive-motion-tag">-motion</span>
          </span>
        </div>
      )}
    </div>
  );
};
