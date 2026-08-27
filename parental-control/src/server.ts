import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { router } from './routes';

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use('/api', router);

// serve demo frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const port = process.env.PORT ? Number(process.env.PORT) : 3333;
app.listen(port, () => {
  console.log(`Parental control server running on http://localhost:${port}`);
});
