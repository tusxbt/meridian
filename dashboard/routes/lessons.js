import { Router } from "express";
import { listLessons, addLesson, pinLesson, unpinLesson, removeLesson } from "../../lessons.js";

const router = Router();

router.get("/lessons", (req, res) => {
  try {
    const opts = {};
    if (req.query.role) opts.role = req.query.role;
    if (req.query.pinned !== undefined) opts.pinned = req.query.pinned === "true";
    if (req.query.tag) opts.tag = req.query.tag;
    if (req.query.limit) opts.limit = Number(req.query.limit);
    res.json(listLessons(opts));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/lessons", (req, res) => {
  try {
    const { rule, tags, pinned, role } = req.body;
    if (!rule) return res.status(400).json({ error: "rule is required" });
    addLesson(rule, tags || [], { pinned: !!pinned, role: role || null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/lessons/:id/pin", (req, res) => {
  try {
    const result = pinLesson(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/lessons/:id/pin", (req, res) => {
  try {
    const result = unpinLesson(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/lessons/:id", (req, res) => {
  try {
    const removed = removeLesson(Number(req.params.id));
    res.json({ removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
