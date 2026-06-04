# Word Tile Night — End-game + Exchange Version

This version includes:

- CWL-style dictionary validation from `data/cwl.txt`
- official English Scrabble-style tile counts: 100 tiles total, including 2 blanks
- official-style tile values
- blank tile support
- drag-and-drop placement
- tile exchange
- end-game scoring
- letter count panel showing how many of each tile are not currently on the board

## Tile Exchange

On your turn:

1. Click one or more tiles in your rack.
2. Click **Exchange Selected**.
3. Confirm the exchange.

This exchanges those tiles and ends your turn.

Exchange is only allowed when there are enough tiles left in the bag to replace the selected tiles.

## End-game Rules

The game ends when:

1. The tile bag is empty and a player uses all tiles in their rack.

When this happens:

- every player loses the value of tiles left in their rack
- the player who went out gains the total value of all opponents' remaining rack tiles

There is also a practical fallback end condition:

- if the bag is empty and every player passes twice in a row, the game ends
- in that case, everyone simply loses the value of their own remaining rack tiles

## Important: Add your CWL word list

A tiny sample `data/cwl.txt` is included for testing only.

To use your chosen CWL list:

1. Open `data/cwl.txt`
2. Delete the sample words
3. Paste your CWL word list, one word per line
4. Save the file
5. Restart the server with:

```bash
npm start
```

The game will show the number of loaded dictionary words in the sidebar.

## Run

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```


## Letter Count Panel

The sidebar includes **Letters Not on Board**.

This shows the number of each physical tile that has not been placed on the board yet. These tiles may be:

- still in the tile bag
- in another player's rack
- in your rack

Placed blank tiles reduce the `Blank` count, even if the blank is representing another letter.
