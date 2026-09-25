# Print agent

Sends kitchen tickets, bills and receipts to the thermal printers on the cafe's network.

```
Phone / tablet ──► API (cloud or local) ──► print jobs ◄── print agent (in the cafe) ──► printer :9100
```

The API renders every ticket to ESC/POS bytes; this agent only forwards them, so it has no
dependencies and never needs updating when ticket layouts change.

## Set up (about 10 minutes)

1. **Give each printer a fixed IP** in the router (print its self-test page to see the current IP).
2. In the POS: **Manage → Kitchen & printers**
   - add a station for each place food/drinks are made (Kitchen, Bar…),
   - add each printer with its IP (kitchen printers belong to a station; one printer is "Receipts"),
   - press **New agent key** and copy it.
3. On an always-on machine in the cafe (cashier PC or Raspberry Pi) with Node 18+:
   ```bash
   sudo mkdir -p /opt/print-agent && sudo cp agent.mjs package.json /opt/print-agent/
   cp .env.example /opt/print-agent/.env   # then edit API_URL and AGENT_KEY
   node /opt/print-agent/agent.mjs          # try it; press "Test" next to a printer in the admin
   ```
4. Make it start on boot: `sudo cp print-agent.service /etc/systemd/system/ && sudo systemctl enable --now print-agent`

Put the agent machine, router and printers on a UPS. If the internet drops, jobs wait in the
API and print as soon as the agent reconnects; the admin shows a red "Not connected" meanwhile.

## Direct mode (no agent)

If the API itself runs on a PC inside the cafe, set `PRINT_MODE=direct` in `apps/api/.env`
and skip the agent: the API opens the TCP connection to the printers itself.

## Limitations

- Printers must speak ESC/POS over raw TCP port 9100 (almost all Epson/Xprinter/Rongta network printers do).
- Text mode can't print Amharic (Ge'ez) characters — keep a Latin name for each menu item as it should appear on tickets.
