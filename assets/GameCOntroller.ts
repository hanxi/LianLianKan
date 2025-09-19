// GameController.ts
import { _decorator, Component, Node, Sprite, Button, Label, SpriteFrame, Vec3, tween, Graphics, Color } from 'cc';
const { ccclass, property } = _decorator;

interface Point { r: number; c: number; }

@ccclass('GameController')
export class GameController extends Component {

    @property({ type: [SpriteFrame] })
    public iconFrames: SpriteFrame[] = [];

    @property(Node)
    public gameBoard: Node = null;

    @property(Label)
    public statusLabel: Label = null;

    @property(Label)
    public scoreLabel: Label = null; // 新增：分数显示

    @property(Label)
    public timeLabel: Label = null;

    @property(Graphics)
    public lineRenderer: Graphics = null;

    private rows = 8;
    private cols = 8;
    private gridSize = 70;
    private board: number[][] = [];
    private selected: Array<Point> = [];
    private score = 0; // 当前分数
    private timeElapsed = 0;     // 已用时间（秒）
    private timerInterval = null; // 定时器句柄

    // 存储每个格子的高亮 Graphics 边框
    private highlightGraphics: { [key: string]: Graphics } = {};

    start() {
        this.initBoard();
        this.generateGrids();
        this.renderBoard();
        this.updateStatus('点击一个图标，再选择另一个相同图标进行连接');
        this.updateScore(0);
        this.startTime(); // 开始计时
    }

    private initBoard() {
        const totalCells = this.rows * this.cols;
        if (totalCells % 2 !== 0) {
            console.error("棋盘格子数必须为偶数");
            return;
        }

        const pairCount = totalCells / 2;
        const iconCount = this.iconFrames.length;

        let icons: number[] = [];
        for (let i = 0; i < pairCount; i++) {
            icons.push(i % iconCount);
        }
        icons = [...icons, ...icons];
        this.shuffle(icons);

        this.board = Array(this.rows).fill(null).map(() => Array(this.cols).fill(-1));

        let idx = 0;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                this.board[r][c] = icons[idx++];
            }
        }
    }

    private generateGrids() {
        this.gameBoard.removeAllChildren();
        const offset = this.gridSize * 0.5;

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const nodeName = `tile_${r}_${c}`;
                const node = new Node(nodeName);
                node.addComponent(Sprite);
                const btn = node.addComponent(Button);
                btn.transition = Button.Transition.SCALE;
                btn.zoomScale = 0.95;

                node.setPosition(
                    c * this.gridSize - this.cols * offset + offset,
                    -(r * this.gridSize) + this.rows * offset - offset
                );

                node.on(Button.EventType.CLICK, () => {
                    this.onTileClick(r, c);
                }, this);

                this.gameBoard.addChild(node);
            }
        }
    }

    private renderBoard() {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const node = this.gameBoard.getChildByName(`tile_${r}_${c}`);
                if (!node) continue;
                const sprite = node.getComponent(Sprite);
                const iconId = this.board[r][c];
                if (iconId === -1) {
                    sprite.spriteFrame = null;
                } else {
                    sprite.spriteFrame = this.iconFrames[iconId];
                }
            }
        }
    }

    // 添加选中边框
    private addHighlightBorder(row: number, col: number) {
        const node = this.gameBoard.getChildByName(`tile_${row}_${col}`);
        if (!node || this.highlightGraphics[`${row},${col}`]) return;

        // 创建边框节点
        const borderNode = new Node('border');
        const g = borderNode.addComponent(Graphics);
        node.addChild(borderNode);

        // 设置位置在中心
        borderNode.setPosition(0, 0);

        // 绘制边框
        const size = 68; // 略大于图标
        const half = size / 2;
        g.lineWidth = 4;
        g.strokeColor = Color.YELLOW.fromHEX('#ffff00'); // 金色
        g.rect(-half, -half, size, size);
        g.stroke();

        // 缓存引用
        this.highlightGraphics[`${row},${col}`] = g;

        // 同时放大图标
        node.setScale(1.1, 1.1, 1);
    }

    // 移除选中边框
    private removeHighlightBorder(row: number, col: number) {
        const node = this.gameBoard.getChildByName(`tile_${row}_${col}`);
        if (!node) return;

        const key = `${row},${col}`;
        if (this.highlightGraphics[key]) {
            const borderNode = this.highlightGraphics[key].node;
            borderNode.destroy(); // 销毁边框节点
            delete this.highlightGraphics[key];
        }

        // 恢复图标大小
        node.setScale(1, 1, 1);
    }

    // 清除所有边框
    private clearAllHighlightBorders() {
        for (const key in this.highlightGraphics) {
            const [r, c] = key.split(',').map(Number);
            this.removeHighlightBorder(r, c);
        }
    }

    private onTileClick(row: number, col: number) {
        if (this.board[row][col] === -1) return;

        if (this.selected.length === 0) {
            this.selected.push({ row, col });
            this.addHighlightBorder(row, col);
            this.updateStatus('选择第二个相同图标');
        }
        else if (this.selected.length === 1) {
            const a = this.selected[0];

            if (a.row === row && a.col === col) {
                this.removeHighlightBorder(row, col);
                this.selected = [];
                this.updateStatus('点击一个图标开始');
                return;
            }

            this.selected.push({ row, col });
            this.addHighlightBorder(row, col); // 添加第二个边框

            if (this.board[a.row][a.col] !== this.board[row][col]) {
                this.showError('❌ 不是相同的图标！');
                this.updateScore(this.score - 1); // 🔽 选错扣1分
                this.delayClearSelection();
                return;
            }

            const path = this.findConnectionPath(a.row, a.col, row, col);
            if (path) {
                this.drawFullPath(path);

                this.scheduleOnce(() => {
                    this.removePair(a.row, a.col, row, col);
                }, 0.4);
            } else {
                this.showError('🚫 路径被阻挡或拐点过多！');
                this.updateScore(this.score - 1); // 🔽 无法连接也扣1分
                this.delayClearSelection();
            }
        }
    }

    private findConnectionPath(r1: number, c1: number, r2: number, c2: number): Point[] | null {
        if (r1 === r2 && c1 === c2) return null;
        if (this.board[r1][c1] !== this.board[r2][c2]) return null;

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const queue: Array<{
            r: number, c: number, turns: number, dir: number, path: Point[]
        }> = [];
        const visited = new Set<string>();

        queue.push({ r: r1, c: c1, turns: -1, dir: -1, path: [{ r: r1, c: c1 }] });
        visited.add(`${r1},${c1},-1`);

        while (queue.length > 0) {
            const { r, c, turns, dir, path } = queue.shift()!;

            if (turns > 2) continue;

            for (let d = 0; d < dirs.length; d++) {
                const [dr, dc] = dirs[d];
                let nr = r + dr;
                let nc = c + dc;
                let newTurns = turns;
                let newDir = d;

                if (dir !== -1 && dir !== d) newTurns++;
                if (newTurns > 2) continue;

                while (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
                    if (this.board[nr][nc] !== -1 && !(nr === r2 && nc === c2)) {
                        break;
                    }

                    const stateKey = `${nr},${nc},${newTurns}`;
                    if (!visited.has(stateKey)) {
                        visited.add(stateKey);

                        const newPath = [...path];
                        const last = newPath[newPath.length - 1];
                        if (last.r !== nr || last.c !== nc) {
                            newPath.push({ r: nr, c: nc });
                        }

                        queue.push({ r: nr, c: nc, turns: newTurns, dir: d, path: newPath });

                        if (nr === r2 && nc === c2) {
                            return newPath;
                        }
                    }

                    nr += dr;
                    nc += dc;
                }
            }
        }
        return null;
    }

    private drawFullPath(path: Point[]) {
        if (!this.lineRenderer || !path || path.length < 2) return;

        this.lineRenderer.clear();

        const turns = path.length - 2;
        let color: Color;
        if (turns <= 0) color = Color.GREEN.fromHEX('#00ff00');
        else if (turns === 1) color = Color.YELLOW.fromHEX('#ffff00');
        else color = Color.BLUE.fromHEX('#ffa500');

        this.lineRenderer.lineWidth = 6;
        this.lineRenderer.strokeColor = color;

        const start = path[0];
        const startPos = this.getGridWorldPosition(start.r, start.c);
        this.lineRenderer.moveTo(startPos.x, startPos.y);

        for (let i = 1; i < path.length; i++) {
            const p = path[i];
            const pos = this.getGridWorldPosition(p.r, p.c);
            this.lineRenderer.lineTo(pos.x, pos.y);
        }
        this.lineRenderer.stroke();

        this.scheduleOnce(() => {
            this.lineRenderer.clear();
        }, 0.8);
    }

    private getGridWorldPosition(row: number, col: number): { x: number, y: number } {
        const offset = this.gridSize * 0.5;
        const x = col * this.gridSize - this.cols * offset + offset;
        const y = -(row * this.gridSize) + this.rows * offset - offset;
        return { x, y };
    }

    private removePair(r1: number, c1: number, r2: number, c2: number) {
        // 清除边框
        this.removeHighlightBorder(r1, c1);
        this.removeHighlightBorder(r2, c2);
        this.selected = [];

        this.board[r1][c1] = -1;
        this.board[r2][c2] = -1;

        // ✅ 加分！每消除一对 +10 分
        this.updateScore(this.score + 10);

        const n1 = this.gameBoard.getChildByName(`tile_${r1}_${c1}`);
        const n2 = this.gameBoard.getChildByName(`tile_${r2}_${c2}`);

        tween(n1)
            .to(0.2, { scale: new Vec3(0.05, 0.05, 1) })
            .call(() => {
                this.renderBoard();
                if (this.checkWin()) {
                    this.stopTime(); // 停止计时
                    this.updateStatus('🎉 恭喜通关！');
                    this.updateScore(this.score + 50); // 通关 bonus
                } else {
                    this.updateStatus('继续消除吧！');
                }
            })
            .start();

        tween(n2)
            .to(0.2, { scale: new Vec3(0.05, 0.05, 1) })
            .start();
    }

    private checkWin(): boolean {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.board[r][c] !== -1) return false;
            }
        }
        return true;
    }

    private updateStatus(msg: string) {
        if (this.statusLabel) this.statusLabel.string = msg;
    }

    private showError(msg: string) {
        this.updateStatus(msg);
    }

    private delayClearSelection() {
        this.scheduleOnce(() => {
            this.clearAllHighlightBorders();
            this.selected = [];
            this.updateStatus('点击一个图标开始');
        }, 0.6);
    }

    private shuffle(arr: any[]) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    // 更新分数显示
    private updateScore(score: number) {
        this.score = score;
        if (this.scoreLabel) {
            this.scoreLabel.string = `分数：${this.score}`;
        }
    }

    private updateTime() {
        this.timeElapsed++;
        if (this.timeLabel) {
            this.timeLabel.string = `时间：${this.timeElapsed}s`;
        }
    }

    // 开始计时
    private startTime() {
        this.timeElapsed = 0;
        this.updateTime();
        this.timerInterval = setInterval(() => {
            this.updateTime();
        }, 1000);
    }

    // 停止计时
    private stopTime() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

}
