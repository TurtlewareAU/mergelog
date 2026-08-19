# MergeLog design gallery

The live SPA contains the selected Strata interface and reads journal data from
the MergeLog service. The five unselected design studies are preserved at
`archive/design-gallery.html` and are not imported by the live application.

```sh
npm install
npm run dev
```

The development server binds to `0.0.0.0`, so it can be opened from another device on the same network using the host machine's LAN IP and the printed port.
