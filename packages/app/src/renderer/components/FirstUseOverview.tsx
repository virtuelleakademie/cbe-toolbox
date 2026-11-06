import type { ChromeCatalogue } from "../../shared/i18n/index.js";
import { useChrome } from "../chrome.js";

export interface FirstUseContent {
  heading: string;
  value: string;
  courseNavigation: string;
  courseChats: string;
  wikiReuse: string;
  wikiGrounding: string;
  attachmentDistinction: string;
  design: string;
  nextAction: string;
  helpAndReread: string;
}

/**
 * Resolve the shared overview from one catalogue. Named course/tab labels are
 * passed from their existing owners rather than copied into onboarding prose,
 * so a vocabulary edit reaches both locations and every language together.
 */
export function firstUseContent(t: ChromeCatalogue): FirstUseContent {
  return {
    heading: t.onboardingHeading,
    value: t.onboardingValue({ course: t.coursesKicker }),
    courseNavigation: t.onboardingCourseNavigation({ course: t.coursesKicker }),
    courseChats: t.onboardingCourseChats({ chats: t.coursesTabChats, wiki: t.coursesTabWiki }),
    wikiReuse: t.onboardingWikiReuse({ wiki: t.coursesTabWiki }),
    wikiGrounding: t.onboardingWikiGrounding,
    attachmentDistinction: t.onboardingAttachmentDistinction,
    design: t.onboardingDesign,
    nextAction: t.onboardingNextAction,
    helpAndReread: t.onboardingHelpAndReread({ about: t.settingsGroupAbout }),
  };
}

/** Semantic slots are independently required even though the visible card joins
 * them into three bullets. This makes omission controls meaningful: retaining a
 * Wiki label cannot hide a missing grounding or attachment distinction. */
export function missingFirstUseContent(content: FirstUseContent): Array<keyof FirstUseContent> {
  return (Object.keys(content) as Array<keyof FirstUseContent>).filter((key) => content[key].trim().length === 0);
}

/**
 * The one content component used by the automatic workspace card and the About
 * disclosure. Only their action rows differ: Begin/Skip hand to the composer;
 * voluntary rereading has one local Close action.
 */
export function FirstUseOverview({
  id,
  mode,
  onBegin,
  onSkip,
  onClose,
}: {
  id: string;
  mode: "automatic" | "reread";
  onBegin?: () => void;
  onSkip?: () => void;
  onClose?: () => void;
}) {
  const t = useChrome();
  const content = firstUseContent(t);
  const headingId = `${id}-heading`;

  return (
    <section
      id={id}
      className={`first-use-overview first-use-overview-${mode}`}
      role="region"
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{content.heading}</h2>
      <p className="first-use-value">{content.value}</p>
      <ul className="first-use-points">
        <li data-onboarding-unit="course">
          <span data-onboarding-part="course-navigation">{content.courseNavigation}</span>{" "}
          <span data-onboarding-part="course-chats">{content.courseChats}</span>
        </li>
        <li data-onboarding-unit="wiki">
          <span data-onboarding-part="wiki-reuse">{content.wikiReuse}</span>{" "}
          <span data-onboarding-part="wiki-grounding">{content.wikiGrounding}</span>{" "}
          <span data-onboarding-part="attachment-distinction">{content.attachmentDistinction}</span>
        </li>
        <li data-onboarding-unit="design">{content.design}</li>
      </ul>
      <p className="first-use-next">{content.nextAction}</p>
      <p className="first-use-help">{content.helpAndReread}</p>
      <div className="first-use-actions">
        {mode === "automatic" ? (
          <>
            <button type="button" className="send" onClick={onBegin}>
              {t.onboardingBegin}
            </button>
            <button type="button" className="set-secondary" onClick={onSkip}>
              {t.onboardingSkip}
            </button>
          </>
        ) : (
          <button type="button" className="set-secondary" onClick={onClose}>
            {t.onboardingClose}
          </button>
        )}
      </div>
    </section>
  );
}
