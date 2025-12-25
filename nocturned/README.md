<h1 align="center">
  <br>
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  nocturned
  <br>
</h1>

<p align="center">Local daemon for real-time web/host communication</p>

<p align="center">
  <a href="#building">Building</a> •
  <a href="#credits">Credits</a> •
  <a href="#donate">Donate</a> •
  <a href="#related">Related</a> •
  <a href="#license">License</a>
</p>

## Building

Use the `Justfile`. `just build` will output a Linux armv7 binary at `nocturned`. Alternatively, you may use (or adjust) the following command: `GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "-s -w" -o nocturned`.

```
$ just -l
Available recipes:
  build
```

## Donate

Nocturne is a massive endeavor, and the team has spent every day over the last year making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the three members of the Nocturne team and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/donate)

## Related

- [nocturne](https://github.com/usenocturne/nocturne)
- [nocturne-ui](https://github.com/usenocturne/nocturne-ui) - Nocturne's standalone web application written with Vite + React

## Credits

This software was made possible only through the following individuals and open source programs:

- [Dominic Frye](https://github.com/itsnebulalol)
- [shadow](https://github.com/68p)

## License

This project is licensed under the **MIT** license.

We kindly ask that any modifications or distributions made outside of direct forks from this repository include attribution to the original project in the README, as we have worked hard on this. :)

---

> © 2025 Vanta Labs.

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.

> [usenocturne.com](https://usenocturne.com) &nbsp;&middot;&nbsp;
> GitHub [@usenocturne](https://github.com/usenocturne)
