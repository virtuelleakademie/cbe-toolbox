# Manual native-surface evidence

Native application menus, installer windows, macOS file/open dialogs and Gatekeeper prompts, and Windows installer/SmartScreen surfaces are **manual-only evidence** owned by Electron/the operating system. They **MUST NOT be generated**: they are not recreated in HTML, injected into the app, produced through CDP or counted in the deterministic screenshot matrix.

Text instructions are preferred while platform trust and installation behavior can change independently. A native screenshot may be added here only after a human capture and review. Its row must name the exact platform, OS version, app/build version, capture date, operator, review date and repository file. No image may contain a real user name, path, credential, Course or personal data.

| Surface                 | Platform                | OS version | App/build               | Capture date | Operator | Review date | Asset/status                                                       |
| ----------------------- | ----------------------- | ---------- | ----------------------- | ------------ | -------- | ----------- | ------------------------------------------------------------------ |
| Installer window        | macOS                   | —          | 0.1.23 signed/notarized | —            | —        | —           | Text only; no image committed                                      |
| Gatekeeper acceptance   | macOS                   | —          | 0.1.23 signed/notarized | —            | —        | —           | Text only; maintained instructions in `../../../closed-testing.md` |
| Native file/open dialog | macOS                   | —          | 0.1.23                  | —            | —        | —           | Text only; app screenshot uses no imitation                        |
| Installer window        | Windows                 | —          | 0.1.23 unsigned         | —            | —        | —           | Text only; no image committed                                      |
| SmartScreen prompt      | Windows                 | —          | 0.1.23 unsigned         | —            | —        | —           | Text only; maintained instructions in `../../../closed-testing.md` |
| Native file/open dialog | Windows                 | —          | 0.1.23                  | —            | —        | —           | Text only; app screenshot uses no imitation                        |
| Native application menu | macOS / Windows / Linux | —          | 0.1.23                  | —            | —        | —           | Text only; platform inventory documented, no generated imitation   |

The em dash means that no manual image claims current evidence. It is not provenance for a generated asset. When an image is added, every dash in its row must be replaced and the app/release owner must review it separately from `npm run docs:screenshots:check`.
