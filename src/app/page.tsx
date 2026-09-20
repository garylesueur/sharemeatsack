import { CurlBlock, HomeLanding } from "@/app/home-landing";
import { AGENT_SAMPLE, HERO, SEAM_SEND, USE_CASES } from "@/app/home-content";
import { HeroScene, SectionLabel, Seam, Steps, UseCases } from "@/components/home-sections";
import { SiteAppearance } from "@/components/site-appearance";
import { SiteShell } from "@/components/site-chrome";
import { SITE_DESCRIPTION } from "@/lib/mcp-docs";
import { CURSOR_PLUGIN_HREF, cursorInstallPageHref } from "@/lib/cursor-install";
import { PRODUCT_SENTENCE } from "@/lib/product";
import { publicOrigin } from "@/lib/public-origin";
import { siteChromeProps } from "@/lib/site-chrome";

export default function Home() {
  const origin = publicOrigin();
  const mcpUrl = `${origin}/mcp`;
  const createUrl = `${origin}/api/v1/transfers`;
  const curl = `curl -sS ${createUrl} \\
  -H 'content-type: application/json' \\
  -d '{
    "action": "send",
    "title": "September invoices",
    "files": [
      {"name": "invoice-q3.pdf", "type": "application/pdf", "size": 184320}
    ]
  }'`;

  return (
    <SiteAppearance>
      <SiteShell {...siteChromeProps()}>
        <header className="pt-16 sm:pt-20">
          <HeroScene
            src="/brand/hero.jpg"
            alt="Silicon offers a page-link card while a meat sack puts a folder on an iron plate."
            eyebrow={HERO.eyebrow}
            title={PRODUCT_SENTENCE}
            description={SITE_DESCRIPTION}
          >
            <HomeLanding
              mcpUrl={mcpUrl}
              cursorHref={cursorInstallPageHref(mcpUrl)}
              pluginHref={CURSOR_PLUGIN_HREF}
            />
          </HeroScene>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            <p className="text-foreground">
              <strong>Get files from Simon.</strong> Confirm who he is, create a request, paste the
              upload link, wait.
            </p>
            <p className="text-foreground">
              <strong>Put files on meatsack, or send them to Simon.</strong> Same page. Confirm him
              only if someone will open the link.
            </p>
          </div>

          <Seam
            wireLabel="one link"
            personLabel="the person"
            agent={AGENT_SAMPLE.map(([className, text], index) => (
              <span key={index} className={className}>
                {text}
              </span>
            ))}
            person={
              <>
                <p className="mb-1 text-[15px] font-semibold tracking-tight">{SEAM_SEND.title}</p>
                <p className="mb-4 text-sm text-muted-foreground">Files for you</p>
                {SEAM_SEND.files.map((file) => (
                  <div
                    key={file.name}
                    className="mb-2 flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                  >
                    <span>{file.name}</span>
                    <span className="text-muted-foreground">Download</span>
                  </div>
                ))}
              </>
            }
          />
        </header>

        <section className="pt-20 sm:pt-24">
          <SectionLabel>How it goes</SectionLabel>
          <Steps steps={HERO.steps} />
        </section>

        <section className="pt-20 sm:pt-24">
          <SectionLabel>What people use it for</SectionLabel>
          <UseCases cases={USE_CASES} />
        </section>

        <section className="pt-20 sm:pt-24">
          <SectionLabel>Or just curl it</SectionLabel>
          <CurlBlock endpoint="POST /api/v1/transfers" curl={curl} />
        </section>
      </SiteShell>
    </SiteAppearance>
  );
}
