// Feature switches: behaviour that is turned off but kept, code and tests, so it can come back by
// flipping one value here. Each switch says what it gates and since when it is off. Tests that
// cover the switched-off behaviour turn it on for themselves (and back off afterwards).

export const features = {
  /**
   * Card step rows change a step in place (ui-spec §8.6): clicking the marker or swiping right
   * ticks / unticks, swiping left or Delete / ⌫ deletes (notes too). Off since 2026-10-06: on a
   * card a step only opens the detail (the whole row, marker included), and every change happens
   * there.
   */
  cardStepActions: false,
};
