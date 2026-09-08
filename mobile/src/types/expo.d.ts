// ==========================================================================
//  The Expo type reference, COMMITTED.
//
//  Expo generates `expo-env.d.ts` at the project root on `expo start`, and its
//  own header says to keep it out of git — so mobile/.gitignore does. tsconfig
//  then `include`s it, along with `.expo/types/**`, which is also ignored.
//
//  Which means: on a fresh checkout NEITHER EXISTS, `expo/types` is never
//  referenced, and the side-effect import of `src/global.css` has no
//  declaration. `tsc --noEmit` exits 2 with TS2307.
//
//  ⚠️ THAT IS THE GATE WE WIRED THIS MORNING. `eas-build-post-install` runs
//  `npm run checks` in exactly this kind of clean environment, so the mobile
//  build gate would have failed on its first real build. It had never passed
//  anywhere except a working tree that already had the generated files. CI
//  found it before a build did.
//
//  This file is the one line that matters, committed, so the type is present
//  from a clone. The generated file still appears locally and repeating a
//  triple-slash reference costs nothing.
//
//  ⚠️ NOT NAMED expo-env.d.ts. mobile/.gitignore line 14 is `expo-env.d.ts`
//  with no leading slash, which git matches as a BASENAME at any depth — so a
//  file of that name anywhere in the tree is ignored. The first attempt at this
//  fix was called src/types/expo-env.d.ts, was silently not committed, and the
//  fresh clone failed identically. Found by re-cloning rather than by looking
//  at the working tree, which is the same lesson twice in one hour.
// ==========================================================================

/// <reference types="expo/types" />
