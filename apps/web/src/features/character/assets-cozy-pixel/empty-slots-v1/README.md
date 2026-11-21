# Empty cosmetic slot icons

`source-sheet.png` is the user-selected seven-slot concept sheet. The generated
icons are used only when the matching cosmetic slot is empty.

- `HEAD`: soft cloth cap
- `FACE`: spectacles
- `TOP`: simple tunic
- `GLOVES`: leather gloves
- `SHOES`: leather boots
- `CAPE`: travel cape
- `BOTTOM`/`WEAPON`: wooden sword

Regenerate the individual 256x256 transparent PNG files from the source sheet:

```shell
node tools/cosmetics/extract-empty-slot-icons.cjs
```

The muted empty-state appearance is applied in CSS, so these source assets stay
faithful to the approved concept and can also be inspected without UI filters.
