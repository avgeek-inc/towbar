# Towbar web UI

Towbar-specific, read-mostly dashboard compositions built from the shared
HeroUI-backed design system. Manifest-owned infrastructure remains visibly
read-only; actions are limited to sync, check, deploy, rollback, and settings.

## Table text

Use `TableCellStack` from `@avgeek-oss/design-system/data-display/table-cell-text` for stacked
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
size to every color variant: 32px desktop height, 12px text, 14px icons and
spinners, and a 6px gap. On touch devices, the height is 34px.
Icon-only buttons use the same height and width.

Let the button size its icons; do not add custom icon dimensions or button
padding. Keep confirmation-dialog actions at their normal size. Inline text
that opens a row's details remains styled as table content.

## Inline external links

Use `InlineExternalLink` from
`@avgeek-oss/design-system/navigation/inline-external-link` for external
text links. It preserves the surrounding typography and provides a dashed
underline, a close superscript arrow, a new-tab hint for screen readers, and
matching hover and keyboard-focus colors. Use `tone="secondary"` within muted
`text-xs` descriptions for quieter dash and arrow colors and a closer underline
that fits the compact line height. Keep headings at their existing heading
size; the link treatment must not reduce their typography. Use `DomainLink`
for hostnames so HTTPS URLs and truncation tooltips remain consistent.

Keep the label square at its edges: a rounded, clipped tooltip label cuts off
the final underline dash. Let the shared component own the underline, arrow,
spacing, and interaction colors.
