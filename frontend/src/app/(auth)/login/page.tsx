import Image from "next/image";
import { LoginEntry } from "./_components/LoginEntry";
import { Badge } from "@/components/ui/Badge";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const googleAvailable = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <Image
              src="/assets/egg-digital.png"
              alt="EGG Digital"
              width={65}
              height={35}
              unoptimized
            />
            <div>
              Candidate Meeting
              <br />
              Scheduler<small>Interview workspace</small>
            </div>
          </div>
        </div>
        <div className={styles.grid}>
          <section className={styles.intro}>
            <div className={styles.eyebrow}>
              A LITTLE STRUCTURE. A BETTER CONVERSATION.
            </div>
            <h1>
              Make room for
              <br />
              your next great hire.
            </h1>
            <p>
              Schedule interviews, view candidate details,
              <br />
              and prepare for every conversation in one place.
            </p>
            {/* Decorative artwork from the approved Login, not meeting data. */}
            <div className={styles.art} aria-hidden="true">
              <div className={styles.disc} />
              <div className={styles.dots} />
              <div className={styles.artCard}>
                <small>MONDAY · 12 OCT 2026</small>
                <strong>Your next conversation</strong>
                <p>Mali Demo · Software Engineer</p>
                <div className={styles.artLine} />
                <div className={styles.artLineShort} />
                <Badge>Confirmed · 10:00–11:00</Badge>
              </div>
              <div className={styles.chip}>Ready for a fresh perspective</div>
            </div>
          </section>
          <LoginEntry googleAvailable={googleAvailable} />
        </div>
      </div>
    </main>
  );
}
