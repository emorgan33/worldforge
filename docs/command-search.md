# Campaign command search

Open Search campaign in the sidebar or press Ctrl/Cmd+K anywhere in the author workspace. The native modal focuses its search input and contains keyboard focus. Escape, the close button, an outside click or the shortcut dismisses it. The shortcut leaves other native modals alone.

Article results are loaded from an owner-scoped server query, including body text, with template, publication status and category filters plus pagination. Categories, workspace tools and New article remain local commands. Category paths distinguish nested folders and identically named articles. See [search improvements](search-improvements.md).

Arrow keys wrap through results; Enter opens the selected result. Pointer selection is also supported. Categories open their selected manager view. Tools include the home, organization, image library, RPG compendium, variables and GM notebook; map/timeline shortcuts appear when those resources exist. New article opens a generic draft whose template can be changed in the editor. The sidebar's existing tree filter remains available.

All result navigation reuses the workspace's existing save-in-progress and unsaved-edit guards. Opening or dismissing the palette does not navigate or discard edits. A canceled navigation leaves the editor intact. Changing the query or filters clears previous article hits so a late response cannot be opened.
