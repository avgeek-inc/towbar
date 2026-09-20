# Towbar web UI

Towbar-specific, read-mostly dashboard compositions built from the shared
HeroUI-backed design system. Manifest-owned infrastructure remains visibly
read-only; actions are limited to sync, check, deploy, rollback, and settings.

## Table text

Use `TableCellStack` from `@workspace/towbar-web-ui/table-cell-text` for stacked
content in a table cell, and `TableCellDescription` for secondary text. This
matches `RelativeTime`: a 2px gap, 14px primary text with a 20px line height,
and 12px secondary text with a 16px line height. These use the shared rem-based
Tailwind scale, so they also follow the user's font-size preferences.

Keep avatars and leading icons beside the stack. Use horizontal gaps for
icons within a line, but do not add custom vertical gaps, line heights, or
margins between the text lines. Width, wrapping, truncation, semantic colors,
and monospace identifiers can be customized without changing this spacing.

`ResourceName` uses this same stack. When a semantic element or tooltip must
own the wrapper, use `tableCellStackClassName` and
`tableCellDescriptionClassName` rather than duplicating their styles.

## Table actions

Use `size="sm"` for every table action, including `Button`, `ButtonLink`,
`ActionButton`, and `CopyTextButton`. The shared design system applies this
size to every color variant: 28px height, 12px text, 14px icons and spinners,
and a 6px gap. Below the desktop breakpoint, the height is 36px for touch.
Icon-only buttons use the same height and width.

Let the button size its icons; do not add custom icon dimensions or button
padding. Keep confirmation-dialog actions at their normal size. Inline text
that opens a row's details remains styled as table content.
