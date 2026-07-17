-- Ganancia del socio (co-inversor de un carro) como CxP propia, separada de la
-- del fondo (PROFIT_SHARE), para no mezclar al socio con los inversionistas.
ALTER TYPE "PayableType" ADD VALUE IF NOT EXISTS 'PARTNER_SHARE';
