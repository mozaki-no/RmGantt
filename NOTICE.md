# Notice

## Upstream

This repository is a fork of
[tiohsa/redmine_canvas_gantt](https://github.com/tiohsa/redmine_canvas_gantt),
copyright the original authors, distributed under the GNU General Public
License version 2 only. The upstream history is preserved in this repository;
commits after the fork point carry the modifications made here.

## License

This fork remains licensed under **GPL-2.0-only**, the same terms as upstream.
See [LICENSE](LICENSE). The license cannot be changed by this fork: the
copyright in the original work belongs to its authors, and GPL-2.0 requires
derivative works to be distributed under the same terms. Redmine itself is
GPL-2.0, so a plugin loaded into the Redmine process is expected to be
GPL-compatible in any case.

Bundled font assets remain separately licensed under the SIL Open Font License
1.1; see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## What GPL-2.0 means for internal use

The following describes the license terms as written; it is not legal advice,
and an organisation adopting this plugin should have its own counsel confirm
the reading against its circumstances.

- **Using and modifying it inside your organisation is unrestricted.** GPL-2.0
  attaches obligations to *distribution*, not to use. Running this plugin on an
  internal Redmine instance — including a version you have modified — does not
  require publishing anything.
- **Internal modifications may stay private.** There is no obligation to
  contribute changes back upstream.
- **GPL-2.0 has no network clause.** Unlike AGPL, serving the software to users
  over a network is not itself distribution.
- **Obligations begin if you distribute the plugin outside your legal entity** —
  shipping it to customers, to a separate group company, or publishing it. In
  that case the recipient must receive the corresponding source under GPL-2.0,
  including your modifications.

Practically: adopting this internally, patching it for your own needs, and
never publishing it is squarely within the license. If you later want to give
it to someone outside the organisation, the source goes with it.

## Changes in this fork

See the commit history. In summary, this fork carries performance work on the
data endpoint, on asset delivery, and on the canvas render loop; see the
"Performance at scale" section of [README.md](README.md) for the operational
side of those changes.
