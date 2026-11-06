import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entries for the left panel's two course levels
 * (`ui-reference-generation` spec, Requirement: UI Element Registry). Colocated
 * with `CoursesPanel.tsx` — when one of these controls changes, update the entry
 * in the same diff and run `npm run ui:reference`.
 *
 * The Wiki inside the course detail has its own entry in
 * `WikiBrowser.ui-registry.ts`; the panel container itself has one in
 * `LeftPanel.ui-registry.ts`. These two cover the levels.
 * Plain data module: type-only imports, no runtime deps. */
export const coursesPanelUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "courses-panel",
    area: "Left panel",
    label: "uiRefCourseList",
    description:
      "The list level of the left panel: one card per course. A course is a self-contained folder carrying its own conversation, canvas, wiki and materials; exactly one course is active at a time, and the chat always works on the active one. A dot on a card signals that the assistant is currently running in that course, or that a run finished there while you were working elsewhere. Cards do not unfold — going into a course means opening its detail level.",
    howToUse:
      "Open the left panel (its Courses icon, its edge chevron, or the course name in the header). Click a course card to make it active — the workspace switches over and that course's conversation resumes where it left off. Click the chevron on a card to open its detail level. The dashed “{{coursesNewCourse}}” card at the end of the list asks for a title and switches you straight into the new course; it is the only place a course is created.",
    affordance: "courseWorkspace",
  },
  {
    id: "course-detail",
    area: "Left panel",
    label: "uiRefCourseDetail",
    description:
      "One course's own level in the left panel: its title with the rename and delete icons, a {{coursesSetActive}} control when it is not the active course, and two tabs — {{coursesTabChats}} lists its stored conversations, the open one marked; {{coursesTabWiki}} is its knowledge wiki. No folder links or raw paths. Deleting is only here, never on a list card, whose surface is the activation control — one mis-click from the app's most destructive action.",
    howToUse:
      "Open a course's detail level with the chevron on its card; “{{coursesBack}}” returns to the list. Rename with the pencil icon; the trash icon by it never deletes on the first click: it names what goes with the course and moves the folder to the system trash, restorable from there. Cancel is pre-selected; Escape dismisses the question. In {{coursesTabChats}}, click a conversation to resume it; rows wait while the agent works.",
    affordance: "courseWorkspace",
  },
];
