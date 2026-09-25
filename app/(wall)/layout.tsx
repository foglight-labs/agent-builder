import { Inter } from "next/font/google";
import FogField from "./fog-field";
import styles from "./wall.module.css";

const inter = Inter({ subsets: ["latin"] });

/**
 * Shared shell for the access screens (login, waitlist, OAuth consent): an
 * animated navy fog of tiles on the left, a light form panel on the right.
 * The visual panel drops away below 900px, leaving the form alone.
 */
export default function WallLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${styles.shell} ${inter.className}`}>
      <div className={styles.visual}>
        <FogField />
      </div>
      <div className={styles.panel}>
        <div className={styles.panelInner}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo svg, no optimization win */}
          <img className={styles.logo} src="/foglight.svg" alt="" width={40} height={40} />
          {children}
        </div>
      </div>
    </div>
  );
}
