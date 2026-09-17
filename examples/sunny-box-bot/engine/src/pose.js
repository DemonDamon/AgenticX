/* L3 — applyPose switch(Pt) + nextGaze. Source $_t Gr(). */
(function (g) {
  const { clamp, rand, sign, K2 } = g.GROK_MATH;
  const { EYE_PLAYLIST } = g.GROK_TABLES;

  function applyPose(state, mt, dtState, now, ctx, extra = {}) {
    const pt = 0;
    let lid = 1;
    let eyeBoost = 1;
    let spin = pt, tx = 0, ty = 0, squash = 1;

    switch (state) {
      case "sleeping": {
        const En = Math.min(dtState / 2, 1);
        const Zt = Math.sin(clamp(dtState / 0.5, 0, 1) * Math.PI);
        spin = pt + 4 * En + Math.sin(mt * 0.25) * 2;
        tx = -2 * En;
        ty = 8 * En + Math.sin(mt * 0.55) * 3 - Zt * 5;
        squash = 1 + Math.sin(mt * 0.55) * 0.016 + Zt * 0.05;
        if (EYE_PLAYLIST.sleeping.includes(extra.eyeTo)) {
          lid = extra.eyeMorphX > 0.85 ? 1 : 0.08;
        } else if (dtState < 1.2) {
          const dn = Math.min(1, dtState / 1);
          lid = Math.max(0.08, 1 - dn * (1 + 0.15 * Math.sin(dtState * 6.5)));
        } else {
          lid = 0.08;
          if (extra.blinkX < 0.18) ctx.forceSleepEye = true;
        }
        break;
      }
      case "waking": {
        if (dtState < 0.5) {
          lid = 0.07;
          ty = 6;
          ctx.wakeEye = [3, 12];
        } else if (dtState < 1.2) {
          lid = 1;
          eyeBoost = 1.12;
          ty = -5;
          tx = 0;
          spin = pt;
          squash = 1.04;
          if (!ctx.wakingBurst) ctx.wantBurst = [rand(9, 13), 0.8];
        } else if (dtState < 2.2) {
          ty = 0;
          squash = 1;
          ctx.wakeEye = [0, 7];
          if (dtState < 1.4) ctx.wakeBlink = true;
        } else {
          const Et = Math.min((dtState - 2.2) / 0.8, 1);
          ctx.wakeEye = [0, 7];
          spin = pt + Math.sin(Et * Math.PI * 3) * 6 * (1 - Et);
          ty = Math.sin(mt * 0.9) * 2;
        }
        break;
      }
      case "idle":
        spin = pt + Math.sin(mt * 0.5) * 1.5 + Math.sin(mt * 0.17) * 0.6;
        tx = Math.sin(mt * 0.27) * 1;
        ty = Math.sin(mt * 0.85) * 1.2;
        squash = 1 + Math.sin(mt * 0.85) * 0.007;
        break;
      case "listening":
        spin = pt + 8 + Math.sin(mt * 0.5) * 1.5;
        tx = 2;
        ty = -2 + Math.sin(mt * 0.8) * 0.8;
        squash = 1.015;
        if (now >= ctx.nodUntil) {
          ctx.nodUntil = now + rand(1800, 3200);
          ctx.nodEnd = now + 380;
        }
        if (now < ctx.nodEnd) {
          const Et = 1 - (ctx.nodEnd - now) / 380;
          ty += Math.sin(Et * Math.PI) * 4.5;
          spin += Math.sin(Et * Math.PI) * 2;
        }
        break;
      case "thinking":
        spin = pt - 9 + Math.sin(mt * 0.35) * 5;
        tx = Math.sin(mt * 0.3) * 5;
        ty = Math.sin(mt * 0.6) * 2.5;
        squash = 1;
        break;
      case "searching": {
        const Et = Math.sin(mt * 1.3);
        spin = pt + Et * 13;
        tx = Et * 7;
        ty = Math.sin(mt * 1.7) * 3;
        squash = 1;
        if (now >= ctx.stAt) {
          ctx.wantPn = [1, sign()];
          ctx.stAt = now + rand(4000, 7000);
        }
        break;
      }
      case "working": {
        const Et = Math.sin(mt * Math.PI * 2 * 1.6);
        spin = pt + 4 + Et * 2.5;
        tx = 3;
        ty = 1.5 + Math.max(0, Et) * 3;
        squash = 1 - Math.max(0, Et) * 0.02;
        if (now >= ctx.stAt) {
          ctx.wantPn = [1, 1];
          ctx.stAt = now + rand(6000, 9000);
        }
        break;
      }
      case "excited": {
        const Et = (mt * 2.2) % 1;
        const En = Math.sin(Et * Math.PI);
        ty = -En * 10 + 2;
        squash = Et < 0.1 ? 0.92 : Et < 0.3 ? 1.05 : 1;
        tx = Math.sin(mt * 1.1) * 4;
        eyeBoost = 1.06;
        spin = pt + Math.sin(mt * Math.PI * 2 * 1.1) * 7;
        if (now >= ctx.stAt) {
          ctx.wantPn = [1, sign()];
          ctx.stAt = now + rand(2800, 5000);
        }
        break;
      }
      case "surprised": {
        const Et = Math.min(dtState / 1.2, 1);
        tx = -4 * (1 - Et);
        ty = -8 * (1 - Et);
        squash = dtState < 0.2 ? 1.08 : 1;
        eyeBoost = 1.15 - Et * 0.08;
        spin = pt + Math.sin(mt * 11) * 1.5 * (1 - Et);
        break;
      }
      case "suspicious":
        spin = pt - 6 + Math.sin(mt * 0.3) * 3;
        tx = Math.sin(mt * 0.25) * -4;
        ty = 1 + Math.sin(mt * 0.45) * 1.2;
        squash = 1;
        lid = 0.85;
        if (now >= ctx.impulseAt) {
          ctx.spinKick = 30;
          ctx.impulseAt = now + rand(4000, 7000);
        }
        break;
      case "angry":
        if (now >= ctx.impulseAt) {
          ctx.angryShakeUntil = now + 420;
          ctx.tyKick = 70;
          ctx.impulseAt = now + rand(1800, 3200);
        }
        spin = pt + (now < ctx.angryShakeUntil ? Math.sin(now * 0.05) * 4.5 : 0);
        tx = 0;
        ty = 3.5;
        squash = 0.975;
        break;
      case "drowsy": {
        spin = pt + Math.sin(mt * 0.32) * 2.5;
        tx = Math.sin(mt * 0.2) * 1.5;
        ty = 6 + Math.sin(mt * 0.36) * 2.2;
        squash = 1 + Math.sin(mt * 0.36) * 0.022;
        lid = 0.34 + Math.sin(mt * 0.8) * 0.07;
        if (now >= ctx.nodUntil && !ctx.slumpAt) ctx.slumpAt = now;
        if (ctx.slumpAt) {
          const En = (now - ctx.slumpAt) / 1000;
          const Zt = 1.7, dn = 0.3, on = 1.5;
          if (En < Zt) {
            const bn = En / Zt, Cn = bn * bn;
            const bi = Math.sin(bn * Math.PI * 2.5) * 2.2 * (1 - bn);
            ty = 6 + Cn * 19 + bi;
            spin = pt + Cn * 10;
            lid = 0.34 - Cn * (0.34 - 0.04);
            squash = 1 - Cn * 0.045;
          } else if (En < Zt + dn) {
            const bn = (En - Zt) / dn, Cn = Math.sin(bn * Math.PI);
            ty = 25 - Cn * 7;
            spin = pt + 10 - Cn * 4;
            lid = 0.04 + Cn * 0.42;
          } else if (En < Zt + dn + on) {
            const bn = (En - Zt - dn) / on;
            const Cn = 1 - Math.pow(1 - bn, 2.2);
            ty = 25 - 19 * Cn;
            spin = pt + 10 * (1 - Cn);
            lid = 0.46 + (0.34 - 0.46) * Cn;
            if (bn > 0.32 && bn < 0.46) lid = 0.05;
          } else {
            ctx.slumpAt = 0;
            ctx.nodUntil = now + rand(1500, 3500);
          }
        }
        break;
      }
      case "happy": {
        const Et = Math.sin(mt * 2.4);
        spin = pt + Math.sin(mt * 1.2) * 3;
        tx = Math.sin(mt * 1.1) * 2.5;
        ty = -Math.abs(Et) * 3;
        squash = 1 + Et * 0.02;
        eyeBoost = 1.05;
        break;
      }
      case "curious":
        spin = pt + 10 + Math.sin(mt * 0.7) * 6;
        tx = Math.sin(mt * 0.6) * 5;
        ty = -2 + Math.sin(mt * 0.9) * 1.5;
        squash = 1.01;
        eyeBoost = 1.08;
        if (now >= ctx.nodUntil) {
          ctx.nodUntil = now + rand(1600, 2800);
          ctx.nodEnd = now + 440;
        }
        if (now < ctx.nodEnd) {
          const Et = 1 - (ctx.nodEnd - now) / 440;
          tx += Math.sin(Et * Math.PI) * 8;
          spin += Math.sin(Et * Math.PI) * 5;
        }
        break;
      case "confused": {
        const Et = Math.sin(mt * 0.8);
        spin = pt + Et * 12;
        tx = Et * 3;
        ty = Math.sin(mt * 0.5) * 2;
        squash = 1;
        lid = 0.9;
        if (now >= ctx.impulseAt) {
          ctx.spinKick = 22;
          ctx.impulseAt = now + rand(2600, 4200);
        }
        break;
      }
      case "bored":
        spin = pt - 3 + Math.sin(mt * 0.25) * 4;
        tx = Math.sin(mt * 0.2) * 4;
        ty = 5 + Math.sin(mt * 0.35) * 1.5;
        squash = 0.99;
        lid = 0.6;
        eyeBoost = 0.98;
        if (now >= ctx.impulseAt) {
          ctx.nodEnd = now + 600;
          ctx.impulseAt = now + rand(4000, 7000);
        }
        if (now < ctx.nodEnd) {
          const Et = 1 - (ctx.nodEnd - now) / 600;
          squash = 1 + Math.sin(Et * Math.PI) * 0.05;
          ty += Math.sin(Et * Math.PI) * 3;
        }
        break;
      case "proud":
        spin = pt + Math.sin(mt * 0.4) * 2.5;
        tx = Math.sin(mt * 0.35) * 2;
        ty = -4 + Math.sin(mt * 0.6);
        squash = 1.03;
        eyeBoost = 1.02;
        lid = 0.9;
        break;
      case "shy":
        spin = pt - 8 + Math.sin(mt * 0.5) * 3;
        tx = -3 + Math.sin(mt * 0.4) * 2;
        ty = 3;
        squash = 0.98;
        eyeBoost = 0.95;
        lid = 0.85;
        break;
      case "sad":
        spin = pt + 3 + Math.sin(mt * 0.3) * 2;
        tx = Math.sin(mt * 0.25) * 1.5;
        ty = 7 + Math.sin(mt * 0.4);
        squash = 0.97;
        lid = 0.7;
        eyeBoost = 0.97;
        break;
      case "laughing": {
        const Et = Math.sin(mt * Math.PI * 2 * 3.2);
        spin = pt + Et * 4;
        tx = Math.sin(mt * 2) * 2;
        ty = -Math.abs(Et) * 5;
        squash = 1 + Et * 0.03;
        lid = 0.7;
        break;
      }
      case "scared":
        spin = pt + Math.sin(now * 0.04) * 2;
        tx = -2 + Math.sin(now * 0.05) * 1.5;
        ty = 2 + Math.sin(mt * 1.5);
        squash = 0.97;
        eyeBoost = 1.12;
        lid = 1.05;
        break;
      case "playful":
        spin = pt + Math.sin(mt * 1.4) * 8;
        tx = Math.sin(mt * 1.1) * 4;
        ty = -Math.abs(Math.sin(mt * 2.2)) * 3;
        squash = 1 + Math.sin(mt * 2.2) * 0.015;
        eyeBoost = 1.06;
        if (now >= ctx.stAt) {
          ctx.wantPn = [1, sign()];
          ctx.stAt = now + rand(3500, 6000);
        }
        break;
      case "celebrate":
        spin = pt;
        tx = 0;
        ty = -Math.abs(Math.sin(mt * 1.6)) * 2.5;
        squash = 1;
        eyeBoost = 1.1;
        lid = 1.1;
        break;
      case "dragging": {
        const En = (dtState % 3.4) / 3.4;
        if (En < 0.12) {
          tx = -16;
          ty = -22;
          spin = pt - 5;
        } else if (En < 0.62) {
          const dn = (En - 0.12) / 0.5;
          tx = -16 + 32 * K2(dn);
          ty = -22 + Math.sin(mt * 1.4) * 2;
          spin = pt + Math.sin(mt * 2.6) * 6;
          eyeBoost = 1.06;
        } else {
          const cycle = Math.floor(dtState / 3.4);
          if (cycle !== ctx.dragCycle) {
            ctx.dragCycle = cycle;
            ctx.tyKick = 90;
          }
          tx = 16;
          ty = 0;
          spin = pt;
        }
        squash = 1;
        break;
      }
      case "humming":
        spin = pt + Math.sin(mt * 0.4) * 2;
        tx = Math.sin(mt * 0.3) * 1.5;
        ty = Math.sin(mt * 0.7) * 1.5;
        squash = 1;
        break;
      case "notifying":
        if (!ctx.notifyPop && dtState > 0.12) {
          ctx.notifyPop = true;
          ctx.tyKick = -26;
          ctx.wantBlink = true;
        }
        eyeBoost = 1 + 0.05 * Math.exp(-dtState * 3);
        spin = pt + 3;
        tx = 2;
        ty = -1;
        squash = 1;
        break;
      default:
        spin = pt;
        tx = 0;
        ty = 0;
        squash = 1;
        break;
    }
    return { spin, tx, ty, squash, lid, eyeBoost };
  }

  function nextGaze(state) {
    switch (state) {
      case "idle":
        return { x: 0, y: 0, hold: [2500, 5500] };
      case "listening":
        return { x: rand(-0.3, 0.3) * 15, y: rand(-0.25, 0.25) * 9, hold: [2200, 4200] };
      case "thinking":
        return { x: sign() * rand(0.5, 1) * 15, y: -rand(0.4, 1) * 9, hold: [1500, 2800] };
      case "searching":
        return { x: sign() * rand(0.7, 1) * 15, y: rand(-1, 1) * 9, hold: [550, 1150] };
      case "working":
        return { x: rand(-0.4, 0.4) * 15, y: rand(0.4, 1) * 9, hold: [1200, 2400] };
      case "excited":
        return { x: rand(-1, 1) * 15, y: rand(-1, 0.3) * 9, hold: [700, 1400] };
      case "surprised":
        return { x: 0, y: 0, hold: [1600, 2600] };
      case "suspicious":
        return { x: sign() * 15, y: 0.3 * 9, hold: [2200, 4200] };
      case "angry":
        return { x: rand(-0.2, 0.2) * 15, y: 0.2 * 9, hold: [1800, 3200] };
      case "drowsy":
        return { x: rand(-0.4, 0.4) * 15, y: rand(0.4, 1) * 9, hold: [2500, 4500] };
      case "happy":
        return { x: rand(-0.7, 0.7) * 15, y: -rand(0, 0.6) * 9, hold: [1800, 3400] };
      case "curious":
        return { x: sign() * rand(0.6, 1) * 15, y: rand(-1, 1) * 9, hold: [950, 1900] };
      case "confused":
        return { x: sign() * rand(0.5, 1) * 15, y: rand(-0.6, 1) * 9, hold: [1100, 2300] };
      case "bored":
        return { x: sign() * rand(0.7, 1) * 15, y: rand(0.4, 0.9) * 9, hold: [3000, 6000] };
      case "proud":
        return { x: rand(-0.3, 0.3) * 15, y: -rand(0.3, 0.7) * 9, hold: [2600, 4600] };
      case "shy":
        return { x: sign() * rand(0.6, 1) * 15, y: rand(0.5, 1) * 9, hold: [2000, 4000] };
      case "sad":
        return { x: rand(-0.3, 0.3) * 15, y: rand(0.6, 1) * 9, hold: [2800, 5000] };
      case "laughing":
        return { x: rand(-0.5, 0.5) * 15, y: -rand(0.2, 0.6) * 9, hold: [800, 1700] };
      case "scared":
        return { x: sign() * rand(0.7, 1) * 15, y: rand(-0.6, 0.6) * 9, hold: [450, 1050] };
      case "playful":
        return { x: sign() * rand(0.5, 1) * 15, y: -rand(0, 0.6) * 9, hold: [900, 1800] };
      case "notifying": {
        const look = Math.random() < 0.72;
        return { x: (look ? 0.45 : 0.1) * 15, y: -(look ? 0.3 : 0.05) * 9, hold: [1200, 2400] };
      }
      default:
        return { x: rand(-0.4, 0.4) * 15, y: rand(-0.3, 0.3) * 9, hold: [2500, 5000] };
    }
  }

  g.GROK_POSE = { applyPose, nextGaze };
})(window);
